/**
 * Tests for persistDcrRegistration
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { persistDcrRegistration } from "./device-flow";
import { Logger } from "../utils/logger";
import type { DCRClientConfig } from "../session/types";

jest.mock("fs", () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    readFile: jest.fn(),
  },
}));

const mockMkdir = fs.promises.mkdir as jest.Mock;
const mockWriteFile = fs.promises.writeFile as jest.Mock;
const mockRename = fs.promises.rename as jest.Mock;

const REGISTRATION: DCRClientConfig = {
  client_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  client_secret: "test-secret",
  client_id_issued_at: 1700000000,
};

const SESSION_DIR = "/tmp/test-phantom-mcp";
const REG_PATH = path.join(SESSION_DIR, "agent-registration.json");
const TMP_PATH = `${REG_PATH}.tmp`;

describe("persistDcrRegistration", () => {
  let logger: Logger;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger("test");
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates the session directory with 0o700 permissions", async () => {
    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    expect(mockMkdir).toHaveBeenCalledWith(SESSION_DIR, { recursive: true, mode: 0o700 });
  });

  it("writes registration JSON to a .tmp file with 0o600 permissions", async () => {
    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    expect(mockWriteFile).toHaveBeenCalledWith(TMP_PATH, JSON.stringify(REGISTRATION, null, 2), { mode: 0o600 });
  });

  it("atomically renames the .tmp file to the final path", async () => {
    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    expect(mockRename).toHaveBeenCalledWith(TMP_PATH, REG_PATH);
  });

  it("writes before renaming", async () => {
    const order: string[] = [];
    mockWriteFile.mockImplementation(() => {
      order.push("writeFile");
    });
    mockRename.mockImplementation(() => {
      order.push("rename");
    });

    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    expect(order).toEqual(["writeFile", "rename"]);
  });

  it("uses ~/.phantom-mcp as the default session directory", async () => {
    await persistDcrRegistration(REGISTRATION, logger);

    expect(mockMkdir).toHaveBeenCalledWith(path.join(os.homedir(), ".phantom-mcp"), expect.any(Object));
  });

  it("logs a success message containing client_id and sessionDir", async () => {
    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    const output = stderrSpy.mock.calls.map(c => c[0]).join("");
    expect(output).toContain("[INFO]");
    expect(output).toContain(REGISTRATION.client_id);
    expect(output).toContain(SESSION_DIR);
  });

  it("does not throw when mkdir fails", async () => {
    mockMkdir.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(persistDcrRegistration(REGISTRATION, logger, SESSION_DIR)).resolves.toBeUndefined();
  });

  it("does not throw when writeFile fails", async () => {
    mockWriteFile.mockRejectedValue(new Error("ENOSPC: no space left on device"));

    await expect(persistDcrRegistration(REGISTRATION, logger, SESSION_DIR)).resolves.toBeUndefined();
  });

  it("does not throw when rename fails", async () => {
    mockRename.mockRejectedValue(new Error("EXDEV: cross-device link not permitted"));

    await expect(persistDcrRegistration(REGISTRATION, logger, SESSION_DIR)).resolves.toBeUndefined();
  });

  it("logs a warning containing the error message on failure", async () => {
    mockWriteFile.mockRejectedValue(new Error("Disk full"));

    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    const output = stderrSpy.mock.calls.map(c => c[0]).join("");
    expect(output).toContain("[WARN]");
    expect(output).toContain("Failed to cache agent registration");
    expect(output).toContain("Disk full");
  });

  it("the written JSON matches the registration object", async () => {
    await persistDcrRegistration(REGISTRATION, logger, SESSION_DIR);

    const writtenJson = (mockWriteFile.mock.calls[0] as unknown[])[1] as string;
    expect(JSON.parse(writtenJson)).toEqual(REGISTRATION);
  });
});
