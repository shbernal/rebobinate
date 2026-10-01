// web-ext ships no types. Only the part `open-gecko.mjs` calls is declared.
declare module 'web-ext' {
  const webExt: {
    cmd: {
      run(
        params: Record<string, unknown>,
        options?: { shouldExitProgram?: boolean },
      ): Promise<unknown>
    }
  }
  export default webExt
}
