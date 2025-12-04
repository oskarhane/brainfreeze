#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline";
import { loadConfig } from "../core/config";
import { MemorySystem } from "../core/memory-system";
import { GraphClient } from "../graph/client";
import { ClaudeClient } from "../ai/claude";
import { OpenAIClient } from "../ai/openai";
import { ChatSession } from "../core/chat-session";

const program = new Command();

function createMemorySystem() {
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database,
  );
  const claude = new ClaudeClient(
    config.anthropic.apiKey,
    config.anthropic.model,
  );
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);
  return new MemorySystem(graph, claude, openai);
}

program
  .name("memory")
  .description("Personal Memory Companion")
  .version("0.1.0");

// Default command: store memory
program.argument("<text>", "text to remember").action(async (text) => {
  const spinner = ora("Storing memory...").start();
  let system: MemorySystem | null = null;
  try {
    system = createMemorySystem();
    const id = await system.remember(text);
    spinner.succeed(chalk.green(`Stored: ${id.substring(0, 8)}...`));
  } catch (error: any) {
    spinner.fail(chalk.red("Failed"));
    console.error(chalk.red(error.message));
    process.exit(1);
  } finally {
    if (system) {
      await system.close();
    }
  }
});

// Recall command
program
  .command("recall")
  .argument("<query>", "search query")
  .option("-l, --limit <n>", "max results", "5")
  .option("--vector-only", "use vector-only search (no graph expansion)", false)
  .action(async (query, opts) => {
    const spinner = ora(
      `Searching${opts.vectorOnly ? " (vector-only)" : " (hybrid)"}...`,
    ).start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const memories = await system.recall(
        query,
        parseInt(opts.limit),
        !opts.vectorOnly,
      );
      spinner.succeed(
        chalk.green(
          `Found ${memories.length}${opts.vectorOnly ? " (vector-only)" : " (hybrid)"}`,
        ),
      );

      if (memories.length === 0) {
        console.log(chalk.yellow("No memories found"));
        return;
      }

      memories.forEach((m, i) => {
        console.log(chalk.blue(`\n${i + 1}. ${m.summary}`));
        console.log(chalk.gray(`   ${m.content}`));
        console.log(
          chalk.dim(`   ${m.timestamp.toLocaleString()} | ${m.type}`),
        );
      });
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (system) {
        await system.close();
      }
    }
  });

// Answer command
program
  .command("answer")
  .description("Get a synthesized answer to your question")
  .argument("<question>", "question to answer")
  .option("-l, --limit <n>", "max memories to consider", "5")
  .option("--vector-only", "use vector-only search (no graph expansion)", false)
  .action(async (question, opts) => {
    const spinner = ora("Thinking...").start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const result = await system.answer(
        question,
        parseInt(opts.limit),
        opts.vectorOnly,
      );
      spinner.succeed(chalk.green("Answer:"));

      console.log(chalk.white(`\n${result.answer}\n`));

      if (result.sources.length > 0) {
        console.log(chalk.dim("Sources:"));
        result.sources.forEach((m, i) => {
          console.log(chalk.dim(`  ${i + 1}. ${m.summary}`));
        });
      }
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (system) {
        await system.close();
      }
    }
  });

// Chat command - interactive REPL
program
  .command("chat")
  .description("Start interactive chat session")
  .action(async () => {
    let system: MemorySystem | null = null;
    const session = new ChatSession();

    try {
      system = createMemorySystem();

      console.log(chalk.cyan("\nMemory Chat"));
      console.log(
        chalk.dim(
          "Commands: list, recall <query>, remember <text>, help, exit\n",
        ),
      );

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const handleInput = async (input: string) => {
        const trimmed = input.trim();

        if (!trimmed) {
          process.stdout.write(chalk.green("> "));
          return;
        }

        // Handle exit
        if (trimmed === "exit" || trimmed === "quit") {
          console.log(chalk.dim("\nGoodbye!"));
          rl.close();
          return;
        }

        // Handle help
        if (trimmed === "help") {
          console.log(chalk.cyan("\nAvailable commands:"));
          console.log(chalk.dim("  list              - List recent memories"));
          console.log(chalk.dim("  recall <query>    - Search memories"));
          console.log(chalk.dim("  remember <text>   - Store a new memory"));
          console.log(chalk.dim("  exit / quit       - Exit chat"));
          console.log(chalk.dim("  <anything else>   - Ask a question\n"));
          process.stdout.write(chalk.green("> "));
          return;
        }

        // Handle list
        if (trimmed === "list") {
          try {
            const memories = await system!.listRecent(10);
            if (memories.length === 0) {
              console.log(chalk.yellow("\nNo memories stored yet\n"));
            } else {
              memories.forEach((m, i) => {
                console.log(chalk.blue(`\n${i + 1}. ${m.summary}`));
                console.log(chalk.dim(`   ${m.content}`));
              });
              console.log();
            }
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          process.stdout.write(chalk.green("> "));
          return;
        }

        // Handle recall
        if (trimmed.startsWith("recall ")) {
          const query = trimmed.slice(7).trim();
          if (!query) {
            console.log(chalk.yellow("\nUsage: recall <query>\n"));
            process.stdout.write(chalk.green("> "));
            return;
          }
          try {
            const spinner = ora("Searching...").start();
            const memories = await system!.recall(query, 5);
            spinner.stop();
            if (memories.length === 0) {
              console.log(chalk.yellow("\nNo memories found\n"));
            } else {
              memories.forEach((m, i) => {
                console.log(chalk.blue(`\n${i + 1}. ${m.summary}`));
                console.log(chalk.dim(`   ${m.content}`));
              });
              console.log();
            }
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          process.stdout.write(chalk.green("> "));
          return;
        }

        // Handle remember
        if (trimmed.startsWith("remember ")) {
          const text = trimmed.slice(9).trim();
          if (!text) {
            console.log(chalk.yellow("\nUsage: remember <text>\n"));
            process.stdout.write(chalk.green("> "));
            return;
          }
          try {
            const spinner = ora("Storing memory...").start();
            const id = await system!.remember(text);
            spinner.succeed(chalk.green(`Stored: ${id.substring(0, 8)}...`));
            console.log();
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          process.stdout.write(chalk.green("> "));
          return;
        }

        // Default: treat as question
        try {
          const spinner = ora("Thinking...").start();
          const result = await system!.chat(trimmed, session);
          spinner.stop();

          console.log(chalk.white(`\n${result.answer}`));

          if (result.sources.length > 0) {
            console.log(chalk.dim("\nSources:"));
            result.sources.forEach((m, i) => {
              console.log(chalk.dim(`  ${i + 1}. ${m.summary}`));
            });
          }
          console.log();
        } catch (error: any) {
          console.log(chalk.red(`Error: ${error.message}\n`));
        }

        process.stdout.write(chalk.green("> "));
      };

      rl.on("line", async (input) => {
        rl.pause();
        await handleInput(input);
        rl.resume();
      });

      rl.on("close", async () => {
        if (system) {
          await system.close();
        }
        process.exit(0);
      });

      process.stdout.write(chalk.green("> "));
    } catch (error: any) {
      console.error(chalk.red(error.message));
      if (system) {
        await system.close();
      }
      process.exit(1);
    }
  });

// List command
program
  .command("list")
  .description("List recent memories")
  .option("-l, --limit <n>", "max results", "10")
  .action(async (opts) => {
    const spinner = ora("Loading memories...").start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const memories = await system.listRecent(parseInt(opts.limit));
      spinner.succeed(chalk.green(`Found ${memories.length}`));

      if (memories.length === 0) {
        console.log(chalk.yellow("No memories stored yet"));
        return;
      }

      memories.forEach((m, i) => {
        console.log(chalk.blue(`\n${i + 1}. ${m.summary}`));
        console.log(chalk.gray(`   ${m.content}`));
        console.log(
          chalk.dim(`   ${m.timestamp.toLocaleString()} | ${m.type}`),
        );
      });
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (system) {
        await system.close();
      }
    }
  });

// Export command
program
  .command("export")
  .description("Export memories to JSON file")
  .argument("<file>", "output file path")
  .action(async (file) => {
    const spinner = ora("Exporting memories...").start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const count = await system.exportMemories(file);
      spinner.succeed(chalk.green(`Exported ${count} memories to ${file}`));
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (system) {
        await system.close();
      }
    }
  });

// Import command
program
  .command("import")
  .description("Import memories from JSON file (re-extracts everything)")
  .argument("<file>", "input file path")
  .action(async (file) => {
    const spinner = ora("Importing memories...").start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const count = await system.importMemories(file);
      spinner.succeed(chalk.green(`Imported ${count} memories`));
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (system) {
        await system.close();
      }
    }
  });

// Init command - setup schema
program
  .command("init")
  .description("Initialize database schema")
  .action(async () => {
    const spinner = ora("Initializing schema...").start();
    let system: MemorySystem | null = null;
    try {
      const config = loadConfig();
      const graph = new GraphClient(
        config.neo4j.uri,
        config.neo4j.user,
        config.neo4j.password,
        config.neo4j.database,
      );
      await graph.initSchema();
      spinner.succeed(
        chalk.green(`Schema initialized on database: ${config.neo4j.database}`),
      );
      await graph.close();
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program.parse();
