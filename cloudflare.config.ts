import { bindings, defineConfig, exports, triggers } from "cf/config";

export default defineConfig({
	accountId: "c02367f81d279ca64168e6cb11e1816c",
	worker: {
		name: "nodewarden",
		compatibilityDate: "2024-01-01",
		entrypoint: "src/index.ts",
		assets: {
			htmlHandling: "none",
			notFoundHandling: "single-page-application",
			runWorkerFirst: true,
		},
		exports: {
			NotificationsHub: exports.durableObject({ storage: "sqlite" }),
			BackupTransferRunner: exports.durableObject({ storage: "sqlite" }),
		},
		triggers: [
			triggers.scheduled({
				schedule: "*/5 * * * *",
			}),
		],
		env: {
			DB: bindings.d1({
				name: "nodewarden-db",
				id: "273f156f-7d70-4359-87ac-945e9eb1e39e",
			}),
			ATTACHMENTS: bindings.r2({
				name: "nodewarden-attachments",
			}),
			NOTIFICATIONS_HUB: bindings.durableObject({
				worker: "nodewarden",
				exportName: "NotificationsHub",
			}),
			BACKUP_TRANSFER_RUNNER: bindings.durableObject({
				worker: "nodewarden",
				exportName: "BackupTransferRunner",
			}),
			JWT_SECRET: bindings.secret(),
			ASSETS: bindings.assets(),
		},
	},
});
