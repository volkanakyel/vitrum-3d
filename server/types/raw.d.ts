/**
 * The sculpt prompts are authored as Markdown and imported as strings. Vite (and
 * so the test run) understands `?raw` natively; Nitro's own raw plugin keys on the
 * extension and would carry the query into the filename, so `nuxt.config.ts` adds
 * a rollup plugin that strips it.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}
