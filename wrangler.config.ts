import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	build: {
		command: "npm run build",
	},
	assetsDirectory: "./dist",
});
