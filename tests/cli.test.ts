import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { loadTestEnv, setupTestDatabase, cleanTestDatabase } from './helpers';
import { $ } from 'bun';

setDefaultTimeout(30000);

describe('CLI Integration', () => {
  beforeAll(async () => {
    await loadTestEnv();
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanTestDatabase();
  });

  describe('memory chat', () => {
    test('should handle todo list query', async () => {
      // Pipe input to chat command
      const result = await $`echo "what todos do i have?" | bun run src/cli/index.ts chat`.nothrow();

      // Should not error
      expect(result.exitCode).toBe(0);

      const output = result.stdout.toString();

      // Should show either "no open todos" or list todos
      const hasValidResponse =
        output.includes('no open todos') ||
        output.includes('You have') ||
        output.includes('todo');

      expect(hasValidResponse).toBe(true);
    });

    test('should handle recall query', async () => {
      const result = await $`echo "recall test" | bun run src/cli/index.ts chat`.quiet().nothrow();

      expect(result.exitCode).toBe(0);

      const output = result.stdout.toString();
      expect(output).toContain('Memory Chat');
    });

    test('should handle general questions', async () => {
      const result = await $`echo "hello" | bun run src/cli/index.ts chat`.nothrow();

      expect(result.exitCode).toBe(0);

      const output = result.stdout.toString();
      // Should get some response, not an error
      expect(output).not.toContain('Error:');
    });

    test('should handle exit command', async () => {
      const result = await $`echo "exit" | bun run src/cli/index.ts chat`.quiet().nothrow();

      expect(result.exitCode).toBe(0);

      const output = result.stdout.toString();
      expect(output).toContain('Goodbye');
    });
  });

  describe('memory answer', () => {
    test('should answer questions', async () => {
      const result = await $`bun run src/cli/index.ts answer "test question"`.nothrow();

      // Should complete without error
      expect(result.exitCode).toBe(0);
    });
  });

  describe('memory recall', () => {
    test('should search memories', async () => {
      const result = await $`bun run src/cli/index.ts recall "test"`.nothrow();

      expect(result.exitCode).toBe(0);
    });
  });
});
