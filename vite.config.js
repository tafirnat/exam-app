import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"
import fs from "fs"
import path from "path"

function generateVersionFile() {
	return {
		name: "generate-version-file",
		buildStart() {
			const publicDir = path.resolve(__dirname, "public")
			if (!fs.existsSync(publicDir)) {
				fs.mkdirSync(publicDir, { recursive: true })
			}
			const versionPath = path.resolve(publicDir, "version.json")
			const data = {
				timestamp: Date.now(),
				buildTime: new Date().toISOString()
			}
			fs.writeFileSync(versionPath, JSON.stringify(data, null, 2))
		}
	}
}

export default defineConfig({
	base: "/",
	plugins: [viteSingleFile(), generateVersionFile()],
})
