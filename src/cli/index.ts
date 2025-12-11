#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline";
import { loadConfig } from "../core/config";
import { MemorySystem } from "../core/memory-system";
import { GraphClient } from "../graph/client";
import { OpenAIClient } from "../ai/openai";
import { ChatSession } from "../core/chat-session";
import type { EntityDisambiguation } from "../core/types";

const program = new Command();

async function promptDisambiguationChat(
  disambiguation: EntityDisambiguation,
  rl: readline.Interface,
): Promise<string | null> {
  // If auto-resolved with high confidence, use that
  if (disambiguation.autoResolved) {
    const resolved =
      disambiguation.candidates[disambiguation.autoResolved.index];
    if (resolved) {
      console.log(
        chalk.dim(
          `  Auto-resolved "${disambiguation.extractedEntity.name}" → ${resolved.entity.name} (${disambiguation.autoResolved.reasoning})`,
        ),
      );
      return resolved.entity.id;
    }
  }

  // Otherwise prompt user
  console.log(
    chalk.yellow(
      `\nMultiple matches for "${disambiguation.extractedEntity.name}":`,
    ),
  );
  disambiguation.candidates.forEach((c, i) => {
    const aliases = c.entity.aliases?.length
      ? ` (aliases: ${c.entity.aliases.join(", ")})`
      : "";
    console.log(
      chalk.dim(
        `  ${i + 1}. ${c.entity.name} - ${c.entity.type}${aliases} [${c.memoryCount} memories]`,
      ),
    );
  });
  console.log(
    chalk.dim(`  ${disambiguation.candidates.length + 1}. Create new entity`),
  );

  return new Promise((resolve) => {
    rl.question(chalk.green("Which one? "), (answer) => {
      const choice = parseInt(answer.trim());
      if (
        isNaN(choice) ||
        choice < 1 ||
        choice > disambiguation.candidates.length + 1
      ) {
        console.log(chalk.yellow("Invalid choice, creating new entity"));
        resolve(null);
      } else if (choice === disambiguation.candidates.length + 1) {
        resolve(null); // Create new
      } else {
        const selected = disambiguation.candidates[choice - 1];
        resolve(selected?.entity.id ?? null);
      }
    });
  });
}

async function promptDisambiguation(
  disambiguation: EntityDisambiguation,
): Promise<string | null> {
  // If auto-resolved with high confidence, use that
  if (disambiguation.autoResolved) {
    const resolved =
      disambiguation.candidates[disambiguation.autoResolved.index];
    if (resolved) {
      console.log(
        chalk.dim(
          `  Auto-resolved "${disambiguation.extractedEntity.name}" → ${resolved.entity.name} (${disambiguation.autoResolved.reasoning})`,
        ),
      );
      return resolved.entity.id;
    }
  }

  // Otherwise prompt user
  console.log(
    chalk.yellow(
      `\nMultiple matches for "${disambiguation.extractedEntity.name}":`,
    ),
  );
  disambiguation.candidates.forEach((c, i) => {
    const aliases = c.entity.aliases?.length
      ? ` (aliases: ${c.entity.aliases.join(", ")})`
      : "";
    console.log(
      chalk.dim(
        `  ${i + 1}. ${c.entity.name} - ${c.entity.type}${aliases} [${c.memoryCount} memories]`,
      ),
    );
  });
  console.log(
    chalk.dim(`  ${disambiguation.candidates.length + 1}. Create new entity`),
  );

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.green("Which one? "), (answer) => {
      rl.close();
      const choice = parseInt(answer.trim());
      if (
        isNaN(choice) ||
        choice < 1 ||
        choice > disambiguation.candidates.length + 1
      ) {
        console.log(chalk.yellow("Invalid choice, creating new entity"));
        resolve(null);
      } else if (choice === disambiguation.candidates.length + 1) {
        resolve(null); // Create new
      } else {
        const selected = disambiguation.candidates[choice - 1];
        resolve(selected?.entity.id ?? null);
      }
    });
  });
}

async function createMemorySystem() {
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database,
  );
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);

  const { createClaudeModel } = await import('../agents/providers');
  const claudeModel = createClaudeModel(config.anthropic.apiKey, config.anthropic.model);

  return new MemorySystem(graph, openai, claudeModel);
}

program
  .name("memory")
  .description("Personal Memory Companion")
  .version("0.1.0");

// Default command: store memory
program.argument("<text>", "text to remember").action(async (text) => {
  const spinner = ora("Processing...").start();
  let system: MemorySystem | null = null;
  try {
    system = createMemorySystem();

    // Prepare memory and check for disambiguation needs
    const { extracted, embedding, disambiguations } =
      await system.prepareMemory(text);

    spinner.stop();

    // Handle any disambiguations
    const entityResolutions = new Map<string, string>();
    for (const disambiguation of disambiguations) {
      const resolvedId = await promptDisambiguation(disambiguation);
      if (resolvedId) {
        entityResolutions.set(disambiguation.extractedEntity.name, resolvedId);
      }
    }

    // Store the memory
    const storeSpinner = ora("Storing...").start();
    const id = await system.storeMemory(
      text,
      extracted,
      embedding,
      entityResolutions,
    );
    storeSpinner.succeed(chalk.green(`Stored: ${id.substring(0, 8)}...`));
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

      console.log(`\n${result.answer}\n`);

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
      system = await createMemorySystem();

      console.log(chalk.cyan("\nMemory Chat"));
      console.log(
        chalk.dim(
          "Commands: list, recall <query>, remember <text>, done <query> <summary>, merge <keep> <remove>, help, exit\n",
        ),
      );

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: chalk.green("> "),
      });

      const showPrompt = () => rl.prompt();
      const createSpinner = (text: string) =>
        ora({ text, discardStdin: false });

      const handleInput = async (input: string) => {
        const trimmed = input.trim();

        if (!trimmed) {
          showPrompt();
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
          console.log(
            chalk.dim("  list                       - List recent memories"),
          );
          console.log(
            chalk.dim("  recall <query>             - Search memories"),
          );
          console.log(
            chalk.dim("  remember <text>            - Store a new memory"),
          );
          console.log(
            chalk.dim("  done <query> | <summary>   - Mark todo as done"),
          );
          console.log(
            chalk.dim("  merge <keep> <remove>      - Merge two entities"),
          );
          console.log(chalk.dim("  exit / quit                - Exit chat"));
          console.log(
            chalk.dim("  <anything else>            - Ask a question\n"),
          );
          showPrompt();
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
          showPrompt();
          return;
        }

        // Handle recall
        if (trimmed.startsWith("recall ")) {
          const query = trimmed.slice(7).trim();
          if (!query) {
            console.log(chalk.yellow("\nUsage: recall <query>\n"));
            showPrompt();
            return;
          }
          try {
            const spinner = createSpinner("Searching...").start();
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
          showPrompt();
          return;
        }

        // Handle remember
        if (trimmed.startsWith("remember ")) {
          const text = trimmed.slice(9).trim();
          if (!text) {
            console.log(chalk.yellow("\nUsage: remember <text>\n"));
            showPrompt();
            return;
          }
          try {
            const spinner = createSpinner("Processing...").start();
            const { expandedText, extracted, embedding, disambiguations } =
              await system!.prepareMemoryWithContext(text, session);
            spinner.stop();

            // Handle disambiguations
            const entityResolutions = new Map<string, string>();
            for (const disambiguation of disambiguations) {
              const resolvedId = await promptDisambiguationChat(
                disambiguation,
                rl,
              );
              if (resolvedId) {
                entityResolutions.set(
                  disambiguation.extractedEntity.name,
                  resolvedId,
                );
              }
            }

            const storeSpinner = createSpinner("Storing...").start();
            const id = await system!.storeMemory(
              expandedText,
              extracted,
              embedding,
              entityResolutions,
            );
            storeSpinner.succeed(
              chalk.green(`Stored: ${id.substring(0, 8)}...`),
            );

            // Add to session history so future references can resolve
            session.addUserMessage(`remember ${text}`);
            session.addAssistantMessage(
              `Stored memory: "${expandedText}" (summary: ${extracted.summary})`,
            );

            console.log();
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          showPrompt();
          return;
        }

        // Handle explicit done command with pipe separator
        if (trimmed.startsWith("done ") && trimmed.includes("|")) {
          const rest = trimmed.slice(5).trim();
          const parts = rest.split("|").map((p) => p.trim());

          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.log(chalk.yellow("\nUsage: done <query> | <summary>\n"));
            console.log(
              chalk.dim(
                "Example: done call John | called and discussed project\n",
              ),
            );
            showPrompt();
            return;
          }

          const [query, summary] = parts;

          try {
            const spinner = createSpinner("Finding todo...").start();
            const result = await system!.markTodoDone(query, summary);
            spinner.succeed(chalk.green(`Marked done: ${result.summary}`));
            console.log(chalk.dim(`  Resolution: ${summary}\n`));
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          showPrompt();
          return;
        }

        // Handle merge
        if (trimmed.startsWith("merge ")) {
          const rest = trimmed.slice(6).trim();
          const parts = rest.split(/\s+/);

          if (parts.length < 2) {
            console.log(chalk.yellow("\nUsage: merge <keep> <remove>\n"));
            console.log(chalk.dim('Example: merge John "John Smith"\n'));
            showPrompt();
            return;
          }

          const keepName = parts[0] || "";
          const removeName = parts.slice(1).join(" ");

          try {
            const spinner = createSpinner("Finding entities...").start();

            const keepCandidates =
              await system!.graph.findSimilarEntities(keepName);
            const removeCandidates =
              await system!.graph.findSimilarEntities(removeName);

            spinner.stop();

            if (keepCandidates.length === 0) {
              console.log(
                chalk.red(`No entities found matching: "${keepName}"\n`),
              );
              showPrompt();
              return;
            }

            if (removeCandidates.length === 0) {
              console.log(
                chalk.red(`No entities found matching: "${removeName}"\n`),
              );
              showPrompt();
              return;
            }

            // Select keep entity
            let keepEntity = keepCandidates[0];
            if (keepCandidates.length > 1) {
              console.log(
                chalk.yellow(`\nMultiple matches for "${keepName}":`),
              );
              keepCandidates.forEach((c, i) => {
                console.log(
                  chalk.dim(
                    `  ${i + 1}. ${c.entity.name} (${c.entity.type}) - ${c.memoryCount} memories`,
                  ),
                );
              });

              const choice = await new Promise<string>((resolve) => {
                rl.question(chalk.green("Which one to keep? "), resolve);
              });

              const choiceNum = parseInt(choice);
              if (
                isNaN(choiceNum) ||
                choiceNum < 1 ||
                choiceNum > keepCandidates.length
              ) {
                console.log(chalk.red("Invalid selection\n"));
                showPrompt();
                return;
              }

              keepEntity = keepCandidates[choiceNum - 1];
            }

            // Select remove entity
            let removeEntity = removeCandidates[0];
            if (removeCandidates.length > 1) {
              console.log(
                chalk.yellow(`\nMultiple matches for "${removeName}":`),
              );
              removeCandidates.forEach((c, i) => {
                console.log(
                  chalk.dim(
                    `  ${i + 1}. ${c.entity.name} (${c.entity.type}) - ${c.memoryCount} memories`,
                  ),
                );
              });

              const choice = await new Promise<string>((resolve) => {
                rl.question(chalk.green("Which one to remove? "), resolve);
              });

              const choiceNum = parseInt(choice);
              if (
                isNaN(choiceNum) ||
                choiceNum < 1 ||
                choiceNum > removeCandidates.length
              ) {
                console.log(chalk.red("Invalid selection\n"));
                showPrompt();
                return;
              }

              removeEntity = removeCandidates[choiceNum - 1];
            }

            if (!keepEntity || !removeEntity) {
              console.log(chalk.red("Entity selection failed\n"));
              showPrompt();
              return;
            }

            if (keepEntity.entity.id === removeEntity.entity.id) {
              console.log(chalk.red("Cannot merge entity with itself\n"));
              showPrompt();
              return;
            }

            console.log(chalk.yellow("\nMerge preview:"));
            console.log(
              chalk.green(
                `  Keep:   ${keepEntity.entity.name} (${keepEntity.entity.type}) - ${keepEntity.memoryCount} memories`,
              ),
            );
            console.log(
              chalk.red(
                `  Remove: ${removeEntity.entity.name} (${removeEntity.entity.type}) - ${removeEntity.memoryCount} memories`,
              ),
            );

            const answer = await new Promise<string>((resolve) => {
              rl.question(chalk.green("\nConfirm merge? (y/n): "), resolve);
            });

            if (answer.toLowerCase() !== "y") {
              console.log(chalk.dim("Cancelled\n"));
              showPrompt();
              return;
            }

            const mergeSpinner = createSpinner("Merging...").start();
            await system!.graph.mergeEntities(
              keepEntity.entity.id,
              removeEntity.entity.id,
            );
            mergeSpinner.succeed(
              chalk.green(
                `Merged "${removeEntity.entity.name}" into "${keepEntity.entity.name}"\n`,
              ),
            );
          } catch (error: any) {
            console.log(chalk.red(`Error: ${error.message}\n`));
          }
          showPrompt();
          return;
        }

        // Default: detect intent and handle accordingly
        try {
          const spinner = createSpinner("Thinking...").start();

          // Detect if this is a todo command
          const intent = await system!.detectIntent(trimmed);

          if (intent.type === "list_todos") {
            spinner.stop();
            const todos = await system!.listTodos();

            if (todos.length === 0) {
              console.log(chalk.yellow("\nYou have no open todos\n"));
            } else {
              console.log(
                chalk.cyan(
                  `\nYou have ${todos.length} todo${todos.length === 1 ? "" : "s"}:`,
                ),
              );
              todos.forEach((t, i) => {
                console.log(chalk.blue(`${i + 1}. ${t.summary}`));
                if (t.content !== t.summary) {
                  console.log(chalk.dim(`   ${t.content}`));
                }
              });
              console.log();
            }
            showPrompt();
            return;
          }

          if (intent.type === "mark_done") {
            spinner.text = "Finding todo...";
            try {
              const result = await system!.markTodoDone(
                intent.query,
                intent.summary,
              );
              spinner.succeed(chalk.green(`Marked done: ${result.summary}`));
              console.log(chalk.dim(`  Resolution: ${intent.summary}\n`));
            } catch (error: any) {
              spinner.fail(chalk.red("Failed"));
              console.log(chalk.red(`Error: ${error.message}\n`));
            }
            showPrompt();
            return;
          }

          // Normal question
          const result = await system!.chat(trimmed, session);
          spinner.stop();

          console.log(`\n${result.answer}`);

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

        showPrompt();
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

      showPrompt();
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

// Merge command - manually merge two entities
program
  .command("merge")
  .description("Manually merge two entities")
  .argument("<keep>", "search string for entity to keep")
  .argument("<remove>", "search string for entity to merge into keep")
  .action(async (keepName, removeName) => {
    const spinner = ora("Finding entities...").start();
    let graph: GraphClient | null = null;
    try {
      const config = loadConfig();
      graph = new GraphClient(
        config.neo4j.uri,
        config.neo4j.user,
        config.neo4j.password,
        config.neo4j.database,
      );

      // Find both entities
      const keepCandidates = await graph.findSimilarEntities(keepName);
      const removeCandidates = await graph.findSimilarEntities(removeName);

      spinner.stop();

      if (keepCandidates.length === 0) {
        console.log(chalk.red(`No entities found matching: "${keepName}"`));
        process.exit(1);
      }

      if (removeCandidates.length === 0) {
        console.log(chalk.red(`No entities found matching: "${removeName}"`));
        process.exit(1);
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Select keep entity if multiple matches
      let keepEntity = keepCandidates[0];
      if (keepCandidates.length > 1) {
        console.log(chalk.yellow(`\nMultiple matches for "${keepName}":`));
        keepCandidates.forEach((c, i) => {
          console.log(
            chalk.dim(
              `  ${i + 1}. ${c.entity.name} (${c.entity.type}) - ${c.memoryCount} memories`,
            ),
          );
        });

        const choice = await new Promise<string>((resolve) => {
          rl.question(chalk.green("Which one to keep? "), resolve);
        });

        const choiceNum = parseInt(choice);
        if (
          isNaN(choiceNum) ||
          choiceNum < 1 ||
          choiceNum > keepCandidates.length
        ) {
          console.log(chalk.red("Invalid selection"));
          rl.close();
          process.exit(1);
        }

        keepEntity = keepCandidates[choiceNum - 1];
      }

      // Select remove entity if multiple matches
      let removeEntity = removeCandidates[0];
      if (removeCandidates.length > 1) {
        console.log(chalk.yellow(`\nMultiple matches for "${removeName}":`));
        removeCandidates.forEach((c, i) => {
          console.log(
            chalk.dim(
              `  ${i + 1}. ${c.entity.name} (${c.entity.type}) - ${c.memoryCount} memories`,
            ),
          );
        });

        const choice = await new Promise<string>((resolve) => {
          rl.question(chalk.green("Which one to remove? "), resolve);
        });

        const choiceNum = parseInt(choice);
        if (
          isNaN(choiceNum) ||
          choiceNum < 1 ||
          choiceNum > removeCandidates.length
        ) {
          console.log(chalk.red("Invalid selection"));
          rl.close();
          process.exit(1);
        }

        removeEntity = removeCandidates[choiceNum - 1];
      }

      if (!keepEntity || !removeEntity) {
        console.log(chalk.red("Entity selection failed"));
        rl.close();
        process.exit(1);
      }

      if (keepEntity.entity.id === removeEntity.entity.id) {
        console.log(chalk.red("Cannot merge entity with itself"));
        rl.close();
        process.exit(1);
      }

      console.log(chalk.yellow("\nMerge preview:"));
      console.log(
        chalk.green(
          `  Keep:   ${keepEntity.entity.name} (${keepEntity.entity.type}) - ${keepEntity.memoryCount} memories`,
        ),
      );
      console.log(
        chalk.red(
          `  Remove: ${removeEntity.entity.name} (${removeEntity.entity.type}) - ${removeEntity.memoryCount} memories`,
        ),
      );

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.green("\nConfirm merge? (y/n): "), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log(chalk.dim("Cancelled"));
        process.exit(0);
      }

      const mergeSpinner = ora("Merging...").start();
      await graph.mergeEntities(keepEntity.entity.id, removeEntity.entity.id);
      mergeSpinner.succeed(
        chalk.green(
          `Merged "${removeEntity.entity.name}" into "${keepEntity.entity.name}"`,
        ),
      );
    } catch (error: any) {
      console.error(chalk.red(`Failed: ${error.message}`));
      process.exit(1);
    } finally {
      if (graph) {
        await graph.close();
      }
    }
  });

// Resolve command - find and merge duplicate entities
// TODO: Re-implement resolve command with agents
/*
program
  .command("resolve")
  .description("Find and merge duplicate entities")
  .action(async () => {
    const spinner = ora("Scanning for duplicates...").start();
    let graph: GraphClient | null = null;
    let claude: ClaudeClient | null = null;
    try {
      const config = loadConfig();
      graph = new GraphClient(
        config.neo4j.uri,
        config.neo4j.user,
        config.neo4j.password,
        config.neo4j.database,
      );
      claude = new ClaudeClient(
        config.anthropic.apiKey,
        config.anthropic.model,
      );

      const resolver = new EntityResolver(graph, claude);
      const candidates = await resolver.findMergeCandidates();

      spinner.stop();

      if (candidates.length === 0) {
        console.log(chalk.green("No duplicate entities found"));
        return;
      }

      console.log(
        chalk.yellow(`\nFound ${candidates.length} potential duplicates:\n`),
      );

      for (const candidate of candidates) {
        const e1 = candidate.entities[0];
        const e2 = candidate.entities[1];

        if (!e1 || !e2) continue;

        console.log(chalk.blue(`"${e1.entity.name}" ↔ "${e2.entity.name}"`));
        console.log(chalk.dim(`  Type: ${e1.entity.type}`));
        console.log(
          chalk.dim(`  Memories: ${e1.memoryCount} vs ${e2.memoryCount}`),
        );
        console.log(chalk.dim(`  Confidence: ${candidate.confidence}`));
        console.log(chalk.dim(`  Reason: ${candidate.reasoning}`));

        const keepEntity = candidate.entities[candidate.suggestedKeep];
        const removeEntity =
          candidate.entities[candidate.suggestedKeep === 0 ? 1 : 0];

        if (!keepEntity || !removeEntity) continue;

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.green(
              `  Merge into "${keepEntity.entity.name}"? (y/n/s to skip all): `,
            ),
            resolve,
          );
        });
        rl.close();

        if (answer.toLowerCase() === "s") {
          console.log(chalk.dim("  Skipping remaining...\n"));
          break;
        }

        if (answer.toLowerCase() === "y") {
          const mergeSpinner = ora("Merging...").start();
          await resolver.mergeEntities(
            keepEntity.entity.id,
            removeEntity.entity.id,
          );
          mergeSpinner.succeed(
            chalk.green(
              `  Merged "${removeEntity.entity.name}" into "${keepEntity.entity.name}"`,
            ),
          );
        } else {
          console.log(chalk.dim("  Skipped\n"));
        }
      }

      console.log(chalk.green("\nDone!"));
    } catch (error: any) {
      spinner.fail(chalk.red("Failed"));
      console.error(chalk.red(error.message));
      process.exit(1);
    } finally {
      if (graph) {
        await graph.close();
      }
    }
  });
*/

// Done command - mark todo as done
program
  .command("done")
  .description("Mark a todo as done/resolved")
  .argument("<query>", "query to find the todo")
  .argument("<summary>", "how it was resolved")
  .action(async (query, summary) => {
    const spinner = ora("Finding todo...").start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const result = await system.markTodoDone(query, summary);
      spinner.succeed(chalk.green(`Marked done: ${result.summary}`));
      console.log(chalk.dim(`  Resolution: ${summary}`));
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
