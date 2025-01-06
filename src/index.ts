import { PostgresDatabaseAdapter } from "@ai16z/adapter-postgres";
import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { DiscordClientInterface } from "@ai16z/client-discord";
import { AutoClientInterface } from "@ai16z/client-auto";
import { TelegramClientInterface } from "@ai16z/client-telegram";
import { TwitterClientInterface } from "@ai16z/client-twitter";
import {
  DbCacheAdapter,
  defaultCharacter,
  FsCacheAdapter,
  ICacheManager,
  IDatabaseCacheAdapter,
  stringToUuid,
  AgentRuntime,
  CacheManager,
  Character,
  IAgentRuntime,
  ModelProviderName,
  elizaLogger,
  settings,
  IDatabaseAdapter,
  validateCharacterConfig,
  Clients,
  CacheStore,
  UUID,
} from "@ai16z/eliza";
import { bootstrapPlugin } from "@ai16z/plugin-bootstrap";
import { createNodePlugin } from "@ai16z/plugin-node";
import Database from "better-sqlite3";
import fs from "fs";
import yargs from "yargs";
import path from "path";
import { fileURLToPath } from "url";
import { DirectClient } from "@ai16z/client-direct";
import RedisClient from "@elizaos/adapter-redis";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
  const waitTime =
    Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
  return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export function parseArguments(): {
  character?: string;
  characters?: string;
} {
  try {
    return yargs(process.argv.slice(2))
      .option("character", {
        type: "string",
        description: "Path to the character JSON file",
      })
      .option("characters", {
        type: "string",
        description: "Comma separated list of paths to character JSON files",
      })
      .parseSync();
  } catch (error) {
    console.error("Error parsing arguments:", error);
    return {};
  }
}

function tryLoadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return null;
  }
}

function isAllStrings(arr: unknown[]): boolean {
  return Array.isArray(arr) && arr.every((item) => typeof item === "string");
}

export async function loadCharacters(
  charactersArg: string
): Promise<Character[]> {
  let characterPaths = charactersArg
    ?.split(",")
    .map((filePath) => filePath.trim());
  const loadedCharacters: Character[] = [];

  if (characterPaths?.length > 0) {
    for (const characterPath of characterPaths) {
      let content: string | null = null;
      let resolvedPath = "";

      // Try different path resolutions in order
      const pathsToTry = [
        characterPath, // exact path as specified
        path.resolve(process.cwd(), characterPath), // relative to cwd
        path.resolve(process.cwd(), "agent", characterPath), // Add this
        path.resolve(__dirname, characterPath), // relative to current script
        path.resolve(__dirname, "characters", path.basename(characterPath)), // relative to agent/characters
        path.resolve(__dirname, "../characters", path.basename(characterPath)), // relative to characters dir from agent
        path.resolve(
          __dirname,
          "../../characters",
          path.basename(characterPath)
        ), // relative to project root characters dir
      ];

      elizaLogger.info(
        "Trying paths:",
        pathsToTry.map((p) => ({
          path: p,
          exists: fs.existsSync(p),
        }))
      );

      for (const tryPath of pathsToTry) {
        content = tryLoadFile(tryPath);
        if (content !== null) {
          resolvedPath = tryPath;
          break;
        }
      }

      if (content === null) {
        elizaLogger.error(
          `Error loading character from ${characterPath}: File not found in any of the expected locations`
        );
        elizaLogger.error("Tried the following paths:");
        pathsToTry.forEach((p) => elizaLogger.error(` - ${p}`));
        process.exit(1);
      }

      try {
        const character = JSON.parse(content);
        validateCharacterConfig(character);

        // Handle plugins
        if (isAllStrings(character.plugins)) {
          elizaLogger.info("Plugins are: ", character.plugins);
          const importedPlugins = await Promise.all(
            character.plugins.map(async (plugin) => {
              const importedPlugin = await import(plugin);
              return importedPlugin.default;
            })
          );
          character.plugins = importedPlugins;
        }

        loadedCharacters.push(character);
        elizaLogger.info(`Successfully loaded character from: ${resolvedPath}`);
      } catch (e) {
        elizaLogger.error(`Error parsing character from ${resolvedPath}: ${e}`);
        process.exit(1);
      }
    }
  }

  if (loadedCharacters.length === 0) {
    elizaLogger.info("No characters found, using default character");
    loadedCharacters.push(defaultCharacter);
  }

  return loadedCharacters;
}

export function getTokenForProvider(
  provider: ModelProviderName,
  character: Character
) {
  switch (provider) {
    case ModelProviderName.OPENAI:
      return (
        character.settings?.secrets?.OPENAI_API_KEY || settings.OPENAI_API_KEY
      );
    case ModelProviderName.LLAMACLOUD:
      return (
        character.settings?.secrets?.LLAMACLOUD_API_KEY ||
        settings.LLAMACLOUD_API_KEY ||
        character.settings?.secrets?.TOGETHER_API_KEY ||
        settings.TOGETHER_API_KEY ||
        character.settings?.secrets?.XAI_API_KEY ||
        settings.XAI_API_KEY ||
        character.settings?.secrets?.OPENAI_API_KEY ||
        settings.OPENAI_API_KEY
      );
    case ModelProviderName.ANTHROPIC:
      return (
        character.settings?.secrets?.ANTHROPIC_API_KEY ||
        character.settings?.secrets?.CLAUDE_API_KEY ||
        settings.ANTHROPIC_API_KEY ||
        settings.CLAUDE_API_KEY
      );
    case ModelProviderName.REDPILL:
      return (
        character.settings?.secrets?.REDPILL_API_KEY || settings.REDPILL_API_KEY
      );
    case ModelProviderName.OPENROUTER:
      return (
        character.settings?.secrets?.OPENROUTER || settings.OPENROUTER_API_KEY
      );
    case ModelProviderName.GROK:
      return character.settings?.secrets?.GROK_API_KEY || settings.GROK_API_KEY;
    case ModelProviderName.HEURIST:
      return (
        character.settings?.secrets?.HEURIST_API_KEY || settings.HEURIST_API_KEY
      );
    case ModelProviderName.GROQ:
      return character.settings?.secrets?.GROQ_API_KEY || settings.GROQ_API_KEY;
  }
}

function initializeDatabase(dataDir: string) {
  if (process.env.POSTGRES_URL) {
    const db = new PostgresDatabaseAdapter({
      connectionString: process.env.POSTGRES_URL,
    });
    return db;
  } else {
    const filePath =
      process.env.SQLITE_FILE ?? path.resolve(dataDir, "db.sqlite");
    // ":memory:";
    const db = new SqliteDatabaseAdapter(new Database(filePath));
    return db;
  }
}

function isFalsish(input: any): boolean {
  // If the input is exactly NaN, return true
  if (Number.isNaN(input)) {
    return true;
  }

  // Convert input to a string if it's not null or undefined
  const value = input == null ? "" : String(input);

  // List of common falsish string representations
  const falsishValues = [
    "false",
    "0",
    "no",
    "n",
    "off",
    "null",
    "undefined",
    "",
  ];

  // Check if the value (trimmed and lowercased) is in the falsish list
  return falsishValues.includes(value.trim().toLowerCase());
}

function getSecret(character: Character, secret: string) {
  return character.settings?.secrets?.[secret] || process.env[secret];
}

// also adds plugins from character file into the runtime
export async function initializeClients(
  character: Character,
  runtime: IAgentRuntime
) {
  // each client can only register once
  // and if we want two we can explicitly support it
  const clients: Record<string, any> = {};
  const clientTypes: string[] =
    character.clients?.map((str) => str.toLowerCase()) || [];
  elizaLogger.log("initializeClients", clientTypes, "for", character.name);

  if (clientTypes.includes(Clients.DIRECT)) {
    const autoClient = await AutoClientInterface.start(runtime);
    if (autoClient) clients.auto = autoClient;
  }

  if (clientTypes.includes(Clients.DISCORD)) {
    const discordClient = await DiscordClientInterface.start(runtime);
    if (discordClient) clients.discord = discordClient;
  }

  if (clientTypes.includes(Clients.TELEGRAM)) {
    const telegramClient = await TelegramClientInterface.start(runtime);
    if (telegramClient) clients.telegram = telegramClient;
  }

  if (clientTypes.includes(Clients.TWITTER)) {
    const twitterClient = await TwitterClientInterface.start(runtime);

    if (twitterClient) {
      clients.twitter = twitterClient;
      (twitterClient as any).enableSearch = !isFalsish(
        getSecret(character, "TWITTER_SEARCH_ENABLE")
      );
    }
  }

  // if (clientTypes.includes(Clients.FARCASTER)) {
  //   // why is this one different :(
  //   const farcasterClient = new FarcasterAgentClient(runtime);
  //   if (farcasterClient) {
  //     farcasterClient.start();
  //     clients.farcaster = farcasterClient;
  //   }
  // }
  // if (clientTypes.includes("lens")) {
  //   const lensClient = new LensAgentClient(runtime);
  //   lensClient.start();
  //   clients.lens = lensClient;
  // }

  elizaLogger.log("client keys", Object.keys(clients));

  // TODO: Add Slack client to the list
  // Initialize clients as an object

  // if (clientTypes.includes("slack")) {
  //   const slackClient = await SlackClientInterface.start(runtime);
  //   if (slackClient) clients.slack = slackClient; // Use object property instead of push
  // }

  if (character.plugins?.length > 0) {
    for (const plugin of character.plugins) {
      if (plugin.clients) {
        for (const client of plugin.clients) {
          const startedClient = await client.start(runtime);
          // clients[client.name] = startedClient; // Assuming client has a name property
        }
      }
    }
  }

  return clients;
}

export function createAgent(
  character: Character,
  db: IDatabaseAdapter,
  cache: ICacheManager,
  token: string
) {
  elizaLogger.success(
    elizaLogger.successesTitle,
    "Creating runtime for character",
    character.name
  );

  let nodePlugin: any | undefined;
  nodePlugin ??= createNodePlugin();

  return new AgentRuntime({
    databaseAdapter: db,
    token,
    modelProvider: character.modelProvider,
    evaluators: [],
    character,
    plugins: [bootstrapPlugin, nodePlugin].filter(Boolean),
    providers: [],
    actions: [],
    services: [],
    managers: [],
    cacheManager: cache,
  });
}

function initializeFsCache(baseDir: string, character: Character) {
  const cacheDir = path.resolve(baseDir, character.id as UUID, "cache");

  const cache = new CacheManager(new FsCacheAdapter(cacheDir));
  return cache;
}

function initializeDbCache(character: Character, db: IDatabaseCacheAdapter) {
  const cache = new CacheManager(new DbCacheAdapter(db, character.id as UUID));
  return cache;
}

function initializeCache(
  cacheStore: string,
  character: Character,
  baseDir?: string,
  db?: IDatabaseCacheAdapter
) {
  switch (cacheStore) {
    case CacheStore.REDIS:
      if (process.env.REDIS_URL) {
        elizaLogger.info("Connecting to Redis...");
        const redisClient = new RedisClient(process.env.REDIS_URL);
        return new CacheManager(
          new DbCacheAdapter(redisClient, character.id as UUID) // Using DbCacheAdapter since RedisClient also implements IDatabaseCacheAdapter
        );
      } else {
        throw new Error("REDIS_URL environment variable is not set.");
      }

    case CacheStore.DATABASE:
      if (db) {
        elizaLogger.info("Using Database Cache...");
        return initializeDbCache(character, db);
      } else {
        throw new Error(
          "Database adapter is not provided for CacheStore.Database."
        );
      }

    case CacheStore.FILESYSTEM:
      elizaLogger.info("Using File System Cache...");
      if (!baseDir) {
        throw new Error(
          "Base directory is not provided for CacheStore.FileSystem."
        );
      }
      return initializeFsCache(baseDir, character);

    default:
      throw new Error(
        `Invalid cache store: ${cacheStore} or required configuration missing.`
      );
  }
}

async function startAgent(
  character: Character,
  directClient: DirectClient
): Promise<AgentRuntime> {
  let db: IDatabaseAdapter & IDatabaseCacheAdapter;
  const dataDir = path.join(__dirname, "../data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = initializeDatabase(dataDir) as IDatabaseAdapter & IDatabaseCacheAdapter;

  try {
    character.id ??= stringToUuid(character.name);
    character.username ??= character.name;

    const token = getTokenForProvider(character.modelProvider, character);
    const dataDir = path.join(__dirname, "../data");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = initializeDatabase(dataDir) as IDatabaseAdapter &
      IDatabaseCacheAdapter;

    await db.init();

    const cache = initializeCache(
      process.env.CACHE_STORE ?? CacheStore.DATABASE,
      character,
      "",
      db
    ); // "" should be replaced with dir for file system caching. THOUGHTS: might probably make this into an env
    if (!token) {
      elizaLogger.error("Token not found for character", character.name);
      throw new Error("Token not found for character");
    }
    const runtime: AgentRuntime = await createAgent(
      character,
      db,
      cache,
      token
    );

    // start services/plugins/process knowledge
    await runtime.initialize();

    // start assigned clients
    runtime.clients = await initializeClients(character, runtime);

    // add to container
    directClient.registerAgent(runtime);

    // report to console
    elizaLogger.debug(`Started ${character.name} as ${runtime.agentId}`);

    return runtime;
  } catch (error) {
    elizaLogger.error(
      `Error starting agent for character ${character.name}:`,
      error
    );
    elizaLogger.error(error);
    if (db) {
      await db.close();
    }
    throw error;
  }
}

const startAgents = async () => {
  const directClient = new DirectClient();
  const serverPort = parseInt(settings.SERVER_PORT || "3000");
  const args = parseArguments();

  let charactersArg = args.characters || args.character;

  let characters = [defaultCharacter];

  if (charactersArg) {
    characters = await loadCharacters(charactersArg);
  }

  try {
    for (const character of characters) {
      await startAgent(character, directClient);
    }
  } catch (error) {
    elizaLogger.error("Error starting agents:", error);
  }

  // upload some agent functionality into directClient
  directClient.startAgent = async (character: Character) => {
    // wrap it so we don't have to inject directClient later
    return startAgent(character, directClient);
  };
  directClient.start(serverPort);

  elizaLogger.log(
    "Run `pnpm start:client` to start the client and visit the outputted URL (http://localhost:5173) to chat with your agents"
  );
};

startAgents().catch((error) => {
  elizaLogger.error("Unhandled error in startAgents:", error);
  process.exit(1); // Exit the process after logging
});
