export default {
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    include: ["src/lib/gemini-demo.test.ts", "src/lib/gemini-demo-path.test.ts"],
  },
};
