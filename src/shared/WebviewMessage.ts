import { z } from "zod"
import { ApiConfiguration, ApiProvider } from "./api"
import { Mode, PromptComponent, ModeConfig } from "./modes"

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type PromptMode = Mode | "enhance"

export type AudioType = "notification" | "celebration" | "progress_loop"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
		| "currentApiConfigName"
		| "saveApiConfiguration"
		| "upsertApiConfiguration"
		| "deleteApiConfiguration"
		| "loadApiConfiguration"
		| "renameApiConfiguration"
		| "getListApiConfiguration"
		| "customInstructions"
		| "allowedCommands"
		| "alwaysAllowReadOnly"
		| "alwaysAllowWrite"
		| "alwaysAllowExecute"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "exportCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
		| "resetState"
		| "requestOllamaModels"
		| "requestLmStudioModels"
		| "openImage"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "refreshOpenRouterModels"
		| "refreshGlamaModels"
		| "refreshUnboundModels"
		| "refreshRequestyModels"
		| "refreshOpenAiModels"
		| "alwaysAllowBrowser"
		| "alwaysAllowMcp"
		| "alwaysAllowModeSwitch"
		| "alwaysAllowSubtasks"
		| "playSound"
		| "soundEnabled"
		| "soundVolume"
		| "diffEnabled"
		| "enableCheckpoints"
		| "checkpointStorage"
		| "browserViewportSize"
		| "screenshotQuality"
		| "openMcpSettings"
		| "restartMcpServer"
		| "toggleToolAlwaysAllow"
		| "toggleMcpServer"
		| "updateMcpTimeout"
		| "fuzzyMatchThreshold"
		| "preferredLanguage"
		| "writeDelayMs"
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "terminalOutputLineLimit"
		| "mcpEnabled"
		| "enableMcpServerCreation"
		| "enableCustomModeCreation"
		| "searchCommits"
		| "alwaysApproveResubmit"
		| "requestDelaySeconds"
		| "rateLimitSeconds"
		| "setApiConfigPassword"
		| "requestVsCodeLmModels"
		| "mode"
		| "updatePrompt"
		| "updateSupportPrompt"
		| "resetSupportPrompt"
		| "getSystemPrompt"
		| "copySystemPrompt"
		| "systemPrompt"
		| "enhancementApiConfigId"
		| "updateExperimental"
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "deleteMcpServer"
		| "maxOpenTabsContext"
		| "humanRelayResponse"
		| "humanRelayCancel"
		| "browserToolEnabled"
		| "telemetrySetting"
		| "showRooIgnoredFiles"
	text?: string
	disabled?: boolean
	askResponse?: ClineAskResponse
	apiConfiguration?: ApiConfiguration
	images?: string[]
	bool?: boolean
	value?: number
	commands?: string[]
	audioType?: AudioType
	serverName?: string
	toolName?: string
	alwaysAllow?: boolean
	mode?: Mode
	promptMode?: PromptMode
	customPrompt?: PromptComponent
	dataUrls?: string[]
	values?: Record<string, any>
	query?: string
	slug?: string
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project"
	requestId?: string
}

// Human relay related message types
export interface HumanRelayResponseMessage extends WebviewMessage {
	type: "humanRelayResponse"
	requestId: string
	text: string
}

export interface HumanRelayCancelMessage extends WebviewMessage {
	type: "humanRelayCancel"
	requestId: string
}

export const checkoutDiffPayloadSchema = z.object({
	ts: z.number(),
	previousCommitHash: z.string().optional(),
	commitHash: z.string(),
	mode: z.enum(["full", "checkpoint"]),
})

export type CheckpointDiffPayload = z.infer<typeof checkoutDiffPayloadSchema>

export const checkoutRestorePayloadSchema = z.object({
	ts: z.number(),
	commitHash: z.string(),
	mode: z.enum(["preview", "restore"]),
})

export type CheckpointRestorePayload = z.infer<typeof checkoutRestorePayloadSchema>

export type WebViewMessagePayload = CheckpointDiffPayload | CheckpointRestorePayload
