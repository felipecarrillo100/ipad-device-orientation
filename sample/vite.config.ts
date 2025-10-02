import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    // Include extra asset types like GLB
    assetsInclude: ["**/*.glb"],

    plugins: [
        // Enable React support
        react({
            jsxRuntime: "automatic", // React 18+ / 19 compatible
        }),
    ],

    server: {
        port: 5174, // you can change this if needed
    },

    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            // Multiple HTML entry points
            input: {
                iframe: path.resolve(__dirname, "index.html"),
            },
        },
    },

    // Optional: treat files in /public as static assets automatically
    publicDir: path.resolve(__dirname, "public"),
    base: "./", // <-- makes the app relative to the current path`
});
