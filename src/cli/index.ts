#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { MemorySystem } from '../core/memory-system';
import { GraphClient } from '../graph/client';
import { ClaudeClient } from '../ai/claude';
import { OpenAIClient } from '../ai/openai';

const program = new Command();

function createMemorySystem() {
  const config = loadConfig();
  const graph = new GraphClient(config.neo4j.uri, config.neo4j.user, config.neo4j.password);
  const claude = new ClaudeClient(config.anthropic.apiKey, config.anthropic.model);
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);
  return new MemorySystem(graph, claude, openai);
}

program
  .name('memory')
  .description('Personal Memory Companion')
  .version('0.1.0');

// Default command: store memory
program
  .argument('<text>', 'text to remember')
  .action(async (text) => {
    const spinner = ora('Storing memory...').start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const id = await system.remember(text);
      spinner.succeed(chalk.green(`Stored: ${id.substring(0, 8)}...`));
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
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
  .command('recall')
  .argument('<query>', 'search query')
  .option('-l, --limit <n>', 'max results', '5')
  .action(async (query, opts) => {
    const spinner = ora('Searching...').start();
    let system: MemorySystem | null = null;
    try {
      system = createMemorySystem();
      const memories = await system.recall(query, parseInt(opts.limit));
      spinner.succeed(chalk.green(`Found ${memories.length}`));

      if (memories.length === 0) {
        console.log(chalk.yellow('No memories found'));
        return;
      }

      memories.forEach((m, i) => {
        console.log(chalk.blue(`\n${i + 1}. ${m.summary}`));
        console.log(chalk.gray(`   ${m.content}`));
        console.log(chalk.dim(`   ${m.timestamp.toLocaleString()} | ${m.type}`));
      });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
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
  .command('init')
  .description('Initialize database schema')
  .action(async () => {
    const spinner = ora('Initializing schema...').start();
    let system: MemorySystem | null = null;
    try {
      const config = loadConfig();
      const graph = new GraphClient(config.neo4j.uri, config.neo4j.user, config.neo4j.password);
      await graph.initSchema();
      spinner.succeed(chalk.green('Schema initialized'));
      await graph.close();
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program.parse();
