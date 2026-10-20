import { writeFileSync, unlinkSync, rmdirSync, rmSync } from "fs";
import { join } from "path";
import { createPrivateTempDir } from "../../../core/lib/secure-fs.js";
import { logger } from "../lib/logger.js";

/**
 * Environment variable to enable mock LLM mode.
 * When set to a file path, agent uses scripted responses instead of Claude API.
 */
export const MOCK_LLM_VAR = "ANVIL_MOCK_LLM_PATH";

/**
 * Mock response script format.
 * Responses are consumed in order; exhausting the script throws an error.
 */
export interface MockScript {
  responses: MockResponse[];
}

export interface MockResponse {
  /** Text content to return */
  content?: string;
  /** Tool calls to make (executed before content response) */
  toolCalls?: MockToolCall[];
  /** Simulate an error response */
  error?: string;
}

export interface MockToolCall {
  /** Tool name (must match SDK tool names: Read, Write, Edit, Bash, etc.) */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Optional: specific tool_use ID (auto-generated if omitted) */
  id?: string;
  /** Mock result to return (default: "OK") */
  mockResult?: string;
  /** Simulate tool failure */
  mockError?: string;
}

const scriptDirectories = new Map<string, string>();

/**
 * Create a mock script file for testing.
 * Returns the file path to pass via ANVIL_MOCK_LLM_PATH.
 */
export function createMockScript(script: MockScript): string {
  const content = JSON.stringify(script, null, 2);
  const directory = createPrivateTempDir("mock-llm-");
  const path = join(directory, "script.json");
  try {
    writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  scriptDirectories.set(path, directory);
  logger.debug(`[mock-llm] Created mock script at ${path}`);
  return path;
}

/**
 * Clean up a mock script file after test completion.
 */
export function cleanupMockScript(path: string): void {
  try {
    unlinkSync(path);
    logger.debug(`[mock-llm] Cleaned up mock script at ${path}`);
  } catch {
    // Ignore cleanup errors
  }
  const directory = scriptDirectories.get(path);
  if (directory) {
    try {
      rmdirSync(directory);
      scriptDirectories.delete(path);
    } catch {
      return;
    }
  }
}

/**
 * Helper functions to build common mock scenarios.
 */
export const MockScripts = {
  /** Simple completion with text response */
  simpleResponse(text: string): MockScript {
    return {
      responses: [{ content: text }],
    };
  },

  /** Read a file then respond with analysis */
  readAndRespond(filePath: string, response: string): MockScript {
    return {
      responses: [
        { toolCalls: [{ name: "Read", input: { file_path: filePath } }] },
        { content: response },
      ],
    };
  },

  /** Write a file and complete */
  writeFile(filePath: string, content: string): MockScript {
    return {
      responses: [
        {
          toolCalls: [
            { name: "Write", input: { file_path: filePath, content } },
          ],
        },
        { content: "File written successfully." },
      ],
    };
  },

  /** Multi-step workflow: read, edit, respond */
  readEditRespond(
    readPath: string,
    editPath: string,
    oldString: string,
    newString: string,
    response: string
  ): MockScript {
    return {
      responses: [
        { toolCalls: [{ name: "Read", input: { file_path: readPath } }] },
        {
          toolCalls: [
            {
              name: "Edit",
              input: {
                file_path: editPath,
                old_string: oldString,
                new_string: newString,
              },
            },
          ],
        },
        { content: response },
      ],
    };
  },

  /** Simulate an error from the LLM */
  errorResponse(errorMessage: string): MockScript {
    return {
      responses: [{ error: errorMessage }],
    };
  },
};
