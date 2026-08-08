export interface ArchitectureSupportError {
  readonly title: string;
  readonly message: string;
}

export const getArchitectureSupportError = (
  platform: string,
  architecture: string
): ArchitectureSupportError | null => {
  if (platform !== "win32" || architecture === "x64") return null;
  return {
    title: "Struq Voice requires 64-bit Windows",
    message:
      `This build supports x64 editions of Windows 10 and 11. ` +
      `The current architecture is ${architecture}. Dictation engines and keyboard integration ` +
      "depend on x64 native modules."
  };
};
