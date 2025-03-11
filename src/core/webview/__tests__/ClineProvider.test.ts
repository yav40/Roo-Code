// npx jest src/core/webview/__tests__/ClineProvider.test.ts

import * as vscode from "vscode"
import axios from "axios"

import { ClineProvider } from "../ClineProvider"
import { ExtensionMessage, ExtensionState } from "../../../shared/ExtensionMessage"
import { GlobalStateKey, SecretKey } from "../../../shared/globalState"
import { setSoundEnabled } from "../../../utils/sound"
import { defaultModeSlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { Cline } from "../../Cline"

// Mock setup must come before imports
jest.mock("../../prompts/sections/custom-instructions")

// Mock ContextProxy
jest.mock("../../contextProxy", () => {
	return {
		ContextProxy: jest.fn().mockImplementation((context) => ({
			originalContext: context,
			extensionUri: context.extensionUri,
			extensionPath: context.extensionPath,
			globalStorageUri: context.globalStorageUri,
			logUri: context.logUri,
			extension: context.extension,
			extensionMode: context.extensionMode,
			getGlobalState: jest
				.fn()
				.mockImplementation((key, defaultValue) => context.globalState.get(key, defaultValue)),
			updateGlobalState: jest.fn().mockImplementation((key, value) => context.globalState.update(key, value)),
			getSecret: jest.fn().mockImplementation((key) => context.secrets.get(key)),
			storeSecret: jest
				.fn()
				.mockImplementation((key, value) =>
					value ? context.secrets.store(key, value) : context.secrets.delete(key),
				),
			saveChanges: jest.fn().mockResolvedValue(undefined),
			dispose: jest.fn().mockResolvedValue(undefined),
			hasPendingChanges: jest.fn().mockReturnValue(false),
			setValue: jest.fn().mockImplementation((key, value) => {
				if (key.startsWith("apiKey") || key.startsWith("openAiApiKey")) {
					return context.secrets.store(key, value)
				}
				return context.globalState.update(key, value)
			}),
			setValues: jest.fn().mockImplementation((values) => {
				const promises = Object.entries(values).map(([key, value]) => context.globalState.update(key, value))
				return Promise.all(promises)
			}),
		})),
	}
})

// Mock dependencies
jest.mock("vscode")
jest.mock("delay")

// Mock BrowserSession
jest.mock("../../../services/browser/BrowserSession", () => ({
	BrowserSession: jest.fn().mockImplementation(() => ({
		testConnection: jest.fn().mockImplementation(async (url) => {
			if (url === "http://localhost:9222") {
				return {
					success: true,
					message: "Successfully connected to Chrome",
					endpoint: "ws://localhost:9222/devtools/browser/123",
				}
			} else {
				return {
					success: false,
					message: "Failed to connect to Chrome",
					endpoint: undefined,
				}
			}
		}),
	})),
}))

// Mock browserDiscovery
jest.mock("../../../services/browser/browserDiscovery", () => ({
	discoverChromeInstances: jest.fn().mockImplementation(async () => {
		return "http://localhost:9222"
	}),
}))
jest.mock(
	"@modelcontextprotocol/sdk/types.js",
	() => ({
		CallToolResultSchema: {},
		ListResourcesResultSchema: {},
		ListResourceTemplatesResultSchema: {},
		ListToolsResultSchema: {},
		ReadResourceResultSchema: {},
		ErrorCode: {
			InvalidRequest: "InvalidRequest",
			MethodNotFound: "MethodNotFound",
			InternalError: "InternalError",
		},
		McpError: class McpError extends Error {
			code: string
			constructor(code: string, message: string) {
				super(message)
				this.code = code
				this.name = "McpError"
			}
		},
	}),
	{ virtual: true },
)

// Initialize mocks
const mockAddCustomInstructions = jest.fn().mockResolvedValue("Combined instructions")
;(jest.requireMock("../../prompts/sections/custom-instructions") as any).addCustomInstructions =
	mockAddCustomInstructions

// Mock delay module
jest.mock("delay", () => {
	const delayFn = (ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return delayFn
})

// MCP-related modules are mocked once above (lines 87-109)

jest.mock(
	"@modelcontextprotocol/sdk/client/index.js",
	() => ({
		Client: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
			listTools: jest.fn().mockResolvedValue({ tools: [] }),
			callTool: jest.fn().mockResolvedValue({ content: [] }),
		})),
	}),
	{ virtual: true },
)

jest.mock(
	"@modelcontextprotocol/sdk/client/stdio.js",
	() => ({
		StdioClientTransport: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
		})),
	}),
	{ virtual: true },
)

// Mock DiffStrategy
jest.mock("../../diff/DiffStrategy", () => ({
	getDiffStrategy: jest.fn().mockImplementation(() => ({
		getToolDescription: jest.fn().mockReturnValue("apply_diff tool description"),
	})),
}))

// Mock dependencies
jest.mock("vscode", () => ({
	ExtensionContext: jest.fn(),
	OutputChannel: jest.fn(),
	WebviewView: jest.fn(),
	Uri: {
		joinPath: jest.fn(),
		file: jest.fn(),
	},
	window: {
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
	},
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue([]),
			update: jest.fn(),
		}),
		onDidChangeConfiguration: jest.fn().mockImplementation((callback) => ({
			dispose: jest.fn(),
		})),
		onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
}))

// Mock sound utility
jest.mock("../../../utils/sound", () => ({
	setSoundEnabled: jest.fn(),
}))

// Mock ESM modules
jest.mock("p-wait-for", () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))

// Mock fs/promises
jest.mock("fs/promises", () => ({
	mkdir: jest.fn(),
	writeFile: jest.fn(),
	readFile: jest.fn(),
	unlink: jest.fn(),
	rmdir: jest.fn(),
}))

// Mock axios
jest.mock("axios", () => ({
	get: jest.fn().mockResolvedValue({ data: { data: [] } }),
	post: jest.fn(),
}))

// Mock buildApiHandler
jest.mock("../../../api", () => ({
	buildApiHandler: jest.fn(),
}))

// Mock system prompt
jest.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: jest.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

// Mock WorkspaceTracker
jest.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return jest.fn().mockImplementation(() => ({
		initializeFilePaths: jest.fn(),
		dispose: jest.fn(),
	}))
})

// Mock Cline
jest.mock("../../Cline", () => ({
	Cline: jest
		.fn()
		.mockImplementation(
			(provider, apiConfiguration, customInstructions, diffEnabled, fuzzyMatchThreshold, task, taskId) => ({
				api: undefined,
				abortTask: jest.fn(),
				handleWebviewAskResponse: jest.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				overwriteClineMessages: jest.fn(),
				overwriteApiConversationHistory: jest.fn(),
				getTaskNumber: jest.fn().mockReturnValue(0),
				setTaskNumber: jest.fn(),
				setParentTask: jest.fn(),
				setRootTask: jest.fn(),
				taskId: taskId || "test-task-id",
			}),
		),
}))

// Mock extract-text
jest.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: jest.fn().mockImplementation(async (filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

// Spy on console.error and console.log to suppress expected messages
beforeAll(() => {
	jest.spyOn(console, "error").mockImplementation(() => {})
	jest.spyOn(console, "log").mockImplementation(() => {})
})

afterAll(() => {
	jest.restoreAllMocks()
})

describe("ClineProvider", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock
	let mockContextProxy: {
		updateGlobalState: jest.Mock
		getGlobalState: jest.Mock
		setValue: jest.Mock
		setValues: jest.Mock
		storeSecret: jest.Mock
		dispose: jest.Mock
	}

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Mock context
		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn().mockImplementation((key: string) => {
					switch (key) {
						case "mode":
							return "architect"
						case "currentApiConfigName":
							return "new-config"
						default:
							return undefined
					}
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: {
				get: jest.fn(),
				store: jest.fn(),
				delete: jest.fn(),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: jest.fn().mockResolvedValue(undefined),
			getCustomModes: jest.fn().mockResolvedValue({ customModes: [] }),
			dispose: jest.fn(),
		}

		// Mock output channel
		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock webview
		mockPostMessage = jest.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn().mockImplementation((callback) => {
				callback()
				return { dispose: jest.fn() }
			}),
			onDidChangeVisibility: jest.fn().mockImplementation((callback) => {
				return { dispose: jest.fn() }
			}),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel)
		// @ts-ignore - Access private property for testing
		mockContextProxy = provider.contextProxy

		// @ts-ignore - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager
	})

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-ignore - accessing private property for testing
		provider.view = mockWebviewView
		expect(ClineProvider.getVisibleInstance()).toBe(provider)
	})

	test("resolveWebviewView sets up webview correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")
	})

	test("resolveWebviewView sets up webview correctly in development mode even if local server is not running", async () => {
		provider = new ClineProvider(
			{ ...mockContext, extensionMode: vscode.ExtensionMode.Development },
			mockOutputChannel,
		)
		;(axios.get as jest.Mock).mockRejectedValueOnce(new Error("Network error"))

		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")

		// Verify Content Security Policy contains the necessary PostHog domains
		expect(mockWebviewView.webview.html).toContain("connect-src https://us.i.posthog.com")
		expect(mockWebviewView.webview.html).toContain("https://us-assets.i.posthog.com")
		expect(mockWebviewView.webview.html).toContain("script-src 'nonce-")
		expect(mockWebviewView.webview.html).toContain("https://us-assets.i.posthog.com")
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const mockState: ExtensionState = {
			version: "1.0.0",
			preferredLanguage: "English",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
			customInstructions: undefined,
			alwaysAllowReadOnly: false,
			alwaysAllowWrite: false,
			alwaysAllowExecute: false,
			alwaysAllowBrowser: false,
			alwaysAllowMcp: false,
			uriScheme: "vscode",
			soundEnabled: false,
			diffEnabled: false,
			enableCheckpoints: false,
			checkpointStorage: "task",
			writeDelayMs: 1000,
			browserViewportSize: "900x600",
			fuzzyMatchThreshold: 1.0,
			mcpEnabled: true,
			enableMcpServerCreation: false,
			requestDelaySeconds: 5,
			rateLimitSeconds: 0,
			mode: defaultModeSlug,
			customModes: [],
			experiments: experimentDefault,
			maxOpenTabsContext: 20,
			browserToolEnabled: true,
			telemetrySetting: "unset",
			showRooIgnoredFiles: true,
		}

		const message: ExtensionMessage = {
			type: "state",
			state: mockState,
		}
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("handles webviewDidLaunch message", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate webviewDidLaunch message
		await messageHandler({ type: "webviewDidLaunch" })

		// Should post state and theme to webview
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("clearTask aborts current task", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const { Cline } = require("../../Cline") // Get the mocked class
		const mockCline = new Cline() // Create a new mocked instance

		// add the mock object to the stack
		await provider.addClineToStack(mockCline)

		// get the stack size before the abort call
		const stackSizeBeforeAbort = provider.getClineStackSize()

		// call the removeClineFromStack method so it will call the current cline abort and remove it from the stack
		await provider.removeClineFromStack()

		// get the stack size after the abort call
		const stackSizeAfterAbort = provider.getClineStackSize()

		// check if the abort method was called
		expect(mockCline.abortTask).toHaveBeenCalled()

		// check if the stack size was decreased
		expect(stackSizeBeforeAbort - stackSizeAfterAbort).toBe(1)
	})

	test("addClineToStack adds multiple Cline instances to the stack", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const { Cline } = require("../../Cline") // Get the mocked class
		const mockCline1 = new Cline() // Create a new mocked instance
		const mockCline2 = new Cline() // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// add Cline instances to the stack
		await provider.addClineToStack(mockCline1)
		await provider.addClineToStack(mockCline2)

		// verify cline instances were added to the stack
		expect(provider.getClineStackSize()).toBe(2)

		// verify current cline instance is the last one added
		expect(provider.getCurrentCline()).toBe(mockCline2)
	})

	test("getState returns correct initial state", async () => {
		const state = await provider.getState()

		expect(state).toHaveProperty("apiConfiguration")
		expect(state.apiConfiguration).toHaveProperty("apiProvider")
		expect(state).toHaveProperty("customInstructions")
		expect(state).toHaveProperty("alwaysAllowReadOnly")
		expect(state).toHaveProperty("alwaysAllowWrite")
		expect(state).toHaveProperty("alwaysAllowExecute")
		expect(state).toHaveProperty("alwaysAllowBrowser")
		expect(state).toHaveProperty("taskHistory")
		expect(state).toHaveProperty("soundEnabled")
		expect(state).toHaveProperty("diffEnabled")
		expect(state).toHaveProperty("writeDelayMs")
	})

	test("preferredLanguage defaults to VSCode language when not set", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "es-ES"

		const state = await provider.getState()
		expect(state.preferredLanguage).toBe("Spanish")
	})

	test("preferredLanguage defaults to English for unsupported VSCode language", async () => {
		// Mock VSCode language as an unsupported language
		;(vscode.env as any).language = "unsupported-LANG"

		const state = await provider.getState()
		expect(state.preferredLanguage).toBe("English")
	})

	test("diffEnabled defaults to true when not set", async () => {
		// Mock globalState.get to return undefined for diffEnabled
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()

		expect(state.diffEnabled).toBe(true)
	})

	test("writeDelayMs defaults to 1000ms", async () => {
		// Mock globalState.get to return undefined for writeDelayMs
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "writeDelayMs") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.writeDelayMs).toBe(1000)
	})

	test("handles writeDelayMs message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "writeDelayMs", value: 2000 })

		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("updates sound utility when sound setting changes", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate setting sound to enabled
		await messageHandler({ type: "soundEnabled", bool: true })
		expect(setSoundEnabled).toHaveBeenCalledWith(true)
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting sound to disabled
		await messageHandler({ type: "soundEnabled", bool: false })
		expect(setSoundEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("requestDelaySeconds defaults to 10 seconds", async () => {
		// Mock globalState.get to return undefined for requestDelaySeconds
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "requestDelaySeconds") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.requestDelaySeconds).toBe(10)
	})

	test("alwaysApproveResubmit defaults to false", async () => {
		// Mock globalState.get to return undefined for alwaysApproveResubmit
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()
		expect(state.alwaysApproveResubmit).toBe(false)
	})

	test("loads saved API config when switching modes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock ConfigManager methods
		provider.configManager = {
			getModeConfigId: jest.fn().mockResolvedValue("test-id"),
			listConfig: jest.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			loadConfig: jest.fn().mockResolvedValue({ apiProvider: "anthropic" }),
			setModeConfig: jest.fn(),
		} as any

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should load the saved config for architect mode
		expect(provider.configManager.getModeConfigId).toHaveBeenCalledWith("architect")
		expect(provider.configManager.loadConfig).toHaveBeenCalledWith("test-config")
		expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
	})

	test("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock ConfigManager methods
		provider.configManager = {
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
			listConfig: jest
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
		} as any

		// Mock current config name
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "currentApiConfigName") {
				return "current-config"
			}
			return undefined
		})

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.configManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	test("saves config as default for current mode when loading config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		provider.configManager = {
			loadConfig: jest.fn().mockResolvedValue({ apiProvider: "anthropic", id: "new-id" }),
			listConfig: jest.fn().mockResolvedValue([{ name: "new-config", id: "new-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config
		await messageHandler({ type: "loadApiConfiguration", text: "new-config" })

		// Should save new config as default for architect mode
		expect(provider.configManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	test("handles browserToolEnabled setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test browserToolEnabled
		await messageHandler({ type: "browserToolEnabled", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("browserToolEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Verify state includes browserToolEnabled
		const state = await provider.getState()
		expect(state).toHaveProperty("browserToolEnabled")
		expect(state.browserToolEnabled).toBe(true) // Default value should be true
	})

	test("handles showRooIgnoredFiles setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test showRooIgnoredFiles with true
		await messageHandler({ type: "showRooIgnoredFiles", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Test showRooIgnoredFiles with false
		jest.clearAllMocks() // Clear all mocks including mockContext.globalState.update
		await messageHandler({ type: "showRooIgnoredFiles", bool: false })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", false)
		expect(mockPostMessage).toHaveBeenCalled()

		// Verify state includes showRooIgnoredFiles
		const state = await provider.getState()
		expect(state).toHaveProperty("showRooIgnoredFiles")
		expect(state.showRooIgnoredFiles).toBe(true) // Default value should be true
	})

	test("handles request delay settings messages", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test alwaysApproveResubmit
		await messageHandler({ type: "alwaysApproveResubmit", bool: true })
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Test requestDelaySeconds
		await messageHandler({ type: "requestDelaySeconds", value: 10 })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("requestDelaySeconds", 10)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: "existing code prompt",
			architect: "existing architect prompt",
		}
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return existingPrompts
			}
			return undefined
		})

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	test("customModePrompts defaults to empty object", async () => {
		// Mock globalState.get to return undefined for customModePrompts
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.customModePrompts).toEqual({})
	})

	test("uses mode-specific custom instructions in Cline initialization", async () => {
		// Setup mock state
		const modeCustomInstructions = "Code mode instructions"
		const mockApiConfig = {
			apiProvider: "openrouter",
			openRouterModelInfo: { supportsComputerUse: true },
		}

		jest.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: mockApiConfig,
			customModePrompts: {
				code: { customInstructions: modeCustomInstructions },
			},
			mode: "code",
			diffEnabled: true,
			enableCheckpoints: false,
			checkpointStorage: "task",
			fuzzyMatchThreshold: 1.0,
			experiments: experimentDefault,
		} as any)

		// Reset Cline mock
		const { Cline } = require("../../Cline")
		;(Cline as jest.Mock).mockClear()

		// Initialize Cline with a task
		await provider.initClineWithTask("Test task")

		// Verify Cline was initialized with mode-specific instructions
		expect(Cline).toHaveBeenCalledWith({
			provider,
			apiConfiguration: mockApiConfig,
			customInstructions: modeCustomInstructions,
			enableDiff: true,
			enableCheckpoints: false,
			checkpointStorage: "task",
			fuzzyMatchThreshold: 1.0,
			task: "Test task",
			experiments: experimentDefault,
		})
	})

	test("handles mode-specific custom instructions updates", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "Code role",
				customInstructions: "Old instructions",
			},
		}
		mockContext.globalState.get = jest.fn((key: string) => {
			if (key === "customModePrompts") {
				return existingPrompts
			}
			return undefined
		})

		// Update custom instructions for code mode
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			code: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})
	})

	test("saves mode config when updating API configuration", async () => {
		// Setup mock context with mode and config name
		mockContext = {
			...mockContext,
			globalState: {
				...mockContext.globalState,
				get: jest.fn((key: string) => {
					if (key === "mode") {
						return "code"
					} else if (key === "currentApiConfigName") {
						return "test-config"
					}
					return undefined
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
		} as unknown as vscode.ExtensionContext

		// Create new provider with updated mock context
		provider = new ClineProvider(mockContext, mockOutputChannel)
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		provider.configManager = {
			listConfig: jest.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
		} as any

		// Update API configuration
		await messageHandler({
			type: "apiConfiguration",
			apiConfiguration: { apiProvider: "anthropic" },
		})

		// Should save config as default for current mode
		expect(provider.configManager.setModeConfig).toHaveBeenCalledWith("code", "test-id")
	})

	test("file content includes line numbers", async () => {
		const { extractTextFromFile } = require("../../../integrations/misc/extract-text")
		const result = await extractTextFromFile("test.js")
		expect(result).toBe("1 | const x = 1;\n2 | const y = 2;\n3 | const z = 3;")
	})

	describe("deleteMessage", () => {
		beforeEach(async () => {
			// Mock window.showInformationMessage
			;(vscode.window.showInformationMessage as jest.Mock) = jest.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test('handles "Just this message" deletion correctly', async () => {
			// Mock user selecting "Just this message"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("Just this message")

			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text", value: 4000 }, // Message to delete
				{ ts: 4000, type: "say", say: "browser_action" }, // Response to delete
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			]

			const mockApiHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }, { ts: 5000 }, { ts: 6000 }]

			// Setup Cline instance with auto-mock from the top of the file
			const { Cline } = require("../../Cline") // Get the mocked class
			const mockCline = new Cline() // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history
			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = jest.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 4000 })

			// Verify correct messages were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([
				mockMessages[0],
				mockMessages[1],
				mockMessages[4],
				mockMessages[5],
			])

			// Verify correct API messages were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([
				mockApiHistory[0],
				mockApiHistory[1],
				mockApiHistory[4],
				mockApiHistory[5],
			])
		})

		test('handles "This and all subsequent messages" deletion correctly', async () => {
			// Mock user selecting "This and all subsequent messages"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("This and all subsequent messages")

			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" },
				{ ts: 2000, type: "say", say: "text", value: 3000 }, // Message to delete
				{ ts: 3000, type: "say", say: "user_feedback" },
				{ ts: 4000, type: "say", say: "user_feedback" },
			]

			const mockApiHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }]

			// Setup Cline instance with auto-mock from the top of the file
			const { Cline } = require("../../Cline") // Get the mocked class
			const mockCline = new Cline() // Create a new mocked instance
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = mockApiHistory
			await provider.addClineToStack(mockCline)

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = jest.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 3000 })

			// Verify only messages before the deleted message were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0]])

			// Verify only API messages before the deleted message were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([mockApiHistory[0]])
		})

		test("handles Cancel correctly", async () => {
			// Mock user selecting "Cancel"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("Cancel")

			// Setup Cline instance with auto-mock from the top of the file
			const { Cline } = require("../../Cline") // Get the mocked class
			const mockCline = new Cline() // Create a new mocked instance
			mockCline.clineMessages = [{ ts: 1000 }, { ts: 2000 }]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }]
			await provider.addClineToStack(mockCline)

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 2000 })

			// Verify no messages were deleted
			expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
			expect(mockCline.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})
	})

	describe("getSystemPrompt", () => {
		beforeEach(async () => {
			mockPostMessage.mockClear()
			await provider.resolveWebviewView(mockWebviewView)
			// Reset and setup mock
			mockAddCustomInstructions.mockClear()
			mockAddCustomInstructions.mockImplementation(
				(modeInstructions: string, globalInstructions: string, cwd: string) => {
					return Promise.resolve(modeInstructions || globalInstructions || "")
				},
			)
		})

		const getMessageHandler = () => {
			const mockCalls = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls
			expect(mockCalls.length).toBeGreaterThan(0)
			return mockCalls[0][0]
		}

		test("handles mcpEnabled setting correctly", async () => {
			// Mock getState to return mcpEnabled: true
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
					openRouterModelInfo: {
						supportsComputerUse: true,
						supportsPromptCache: false,
						maxTokens: 4096,
						contextWindow: 8192,
						supportsImages: false,
						inputPrice: 0.0,
						outputPrice: 0.0,
						description: undefined,
					},
				},
				mcpEnabled: true,
				enableMcpServerCreation: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			const handler1 = getMessageHandler()
			expect(typeof handler1).toBe("function")
			await handler1({ type: "getSystemPrompt", mode: "code" })

			// Verify mcpHub is passed when mcpEnabled is true
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
				}),
			)

			// Mock getState to return mcpEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
					openRouterModelInfo: {
						supportsComputerUse: true,
						supportsPromptCache: false,
						maxTokens: 4096,
						contextWindow: 8192,
						supportsImages: false,
						inputPrice: 0.0,
						outputPrice: 0.0,
						description: undefined,
					},
				},
				mcpEnabled: false,
				enableMcpServerCreation: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			const handler2 = getMessageHandler()
			await handler2({ type: "getSystemPrompt", mode: "code" })

			// Verify mcpHub is not passed when mcpEnabled is false
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
				}),
			)
		})

		test("handles errors gracefully", async () => {
			// Mock SYSTEM_PROMPT to throw an error
			const systemPrompt = require("../../prompts/system")
			jest.spyOn(systemPrompt, "SYSTEM_PROMPT").mockRejectedValueOnce(new Error("Test error"))

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "getSystemPrompt", mode: "code" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to get system prompt")
		})

		test("uses code mode custom instructions", async () => {
			// Get the mock function
			const mockAddCustomInstructions = (jest.requireMock("../../prompts/sections/custom-instructions") as any)
				.addCustomInstructions

			// Clear any previous calls
			mockAddCustomInstructions.mockClear()

			// Mock SYSTEM_PROMPT
			const systemPromptModule = require("../../prompts/system")
			jest.spyOn(systemPromptModule, "SYSTEM_PROMPT").mockImplementation(async () => {
				await mockAddCustomInstructions("Code mode specific instructions", "", "/mock/path")
				return "mocked system prompt"
			})

			// Trigger getSystemPrompt
			const promptHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await promptHandler({ type: "getSystemPrompt" })

			// Verify mock was called with code mode instructions
			expect(mockAddCustomInstructions).toHaveBeenCalledWith(
				"Code mode specific instructions",
				"",
				expect.any(String),
			)
		})

		test("passes diffStrategy and diffEnabled to SYSTEM_PROMPT when previewing", async () => {
			// Setup Cline instance with mocked api.getModel()
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock getState to return experimentalDiffStrategy, diffEnabled and fuzzyMatchThreshold
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					apiModelId: "test-model",
					openRouterModelInfo: { supportsComputerUse: true },
				},
				customModePrompts: {},
				mode: "code",
				enableMcpServerCreation: true,
				mcpEnabled: false,
				browserViewportSize: "900x600",
				experimentalDiffStrategy: true,
				diffEnabled: true,
				fuzzyMatchThreshold: 0.8,
				experiments: experimentDefault,
				browserToolEnabled: true,
			} as any)

			// Mock SYSTEM_PROMPT to verify diffStrategy and diffEnabled are passed
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify key parameters
			expect(callArgs[2]).toBe(true) // supportsComputerUse
			expect(callArgs[3]).toBeUndefined() // mcpHub (disabled)
			expect(callArgs[4]).toHaveProperty("getToolDescription") // diffStrategy
			expect(callArgs[5]).toBe("900x600") // browserViewportSize
			expect(callArgs[6]).toBe("code") // mode
			expect(callArgs[11]).toBe(true) // diffEnabled

			// Run the test again to verify it's consistent
			await handler({ type: "getSystemPrompt", mode: "code" })
			expect(systemPromptSpy).toHaveBeenCalledTimes(2)
		})

		test("passes diffEnabled: false to SYSTEM_PROMPT when diff is disabled", async () => {
			// Setup Cline instance with mocked api.getModel()
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock getState to return diffEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					apiModelId: "test-model",
					openRouterModelInfo: { supportsComputerUse: true },
				},
				customModePrompts: {},
				mode: "code",
				mcpEnabled: false,
				browserViewportSize: "900x600",
				experimentalDiffStrategy: true,
				diffEnabled: false,
				fuzzyMatchThreshold: 0.8,
				experiments: experimentDefault,
				enableMcpServerCreation: true,
				browserToolEnabled: true,
			} as any)

			// Mock SYSTEM_PROMPT to verify diffEnabled is passed as false
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify key parameters
			expect(callArgs[2]).toBe(true) // supportsComputerUse
			expect(callArgs[3]).toBeUndefined() // mcpHub (disabled)
			expect(callArgs[4]).toHaveProperty("getToolDescription") // diffStrategy
			expect(callArgs[5]).toBe("900x600") // browserViewportSize
			expect(callArgs[6]).toBe("code") // mode
			expect(callArgs[11]).toBe(false) // diffEnabled should be false
		})

		test("uses correct mode-specific instructions when mode is specified", async () => {
			// Mock getState to return architect mode instructions
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					openRouterModelInfo: { supportsComputerUse: true },
				},
				customModePrompts: {
					architect: { customInstructions: "Architect mode instructions" },
				},
				mode: "architect",
				enableMcpServerCreation: false,
				mcpEnabled: false,
				browserViewportSize: "900x600",
				experiments: experimentDefault,
			} as any)

			// Mock SYSTEM_PROMPT to call addCustomInstructions
			const systemPromptModule = require("../../prompts/system")
			jest.spyOn(systemPromptModule, "SYSTEM_PROMPT").mockImplementation(async () => {
				await mockAddCustomInstructions("Architect mode instructions", "", "/mock/path")
				return "mocked system prompt"
			})

			// Resolve webview and trigger getSystemPrompt
			await provider.resolveWebviewView(mockWebviewView)
			const architectHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await architectHandler({ type: "getSystemPrompt" })

			// Verify architect mode instructions were used
			expect(mockAddCustomInstructions).toHaveBeenCalledWith(
				"Architect mode instructions",
				"",
				expect.any(String),
			)
		})

		// Tests for browser tool support
		test("correctly extracts modelSupportsComputerUse from Cline instance", async () => {
			// Setup Cline instance with mocked api.getModel()
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: true
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: true,
				mode: "code",
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			expect(callArgs[2]).toBe(true)
		})

		test("correctly handles when model doesn't support computer use", async () => {
			// Setup Cline instance with mocked api.getModel() that doesn't support computer use
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "non-computer-use-model",
					info: { supportsComputerUse: false },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: true
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: true,
				mode: "code",
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			// Even though browserToolEnabled is true, the model doesn't support it
			expect(callArgs[2]).toBe(false)
		})

		test("correctly handles when browserToolEnabled is false", async () => {
			// Setup Cline instance with mocked api.getModel() that supports computer use
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: false,
				mode: "code",
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			// Even though model supports it, browserToolEnabled is false
			expect(callArgs[2]).toBe(false)
		})

		test("correctly calculates canUseBrowserTool as combination of model support and setting", async () => {
			// Setup Cline instance with mocked api.getModel()
			const { Cline } = require("../../Cline")
			const mockCline = new Cline()
			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}
			await provider.addClineToStack(mockCline)

			// Mock SYSTEM_PROMPT
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Test all combinations of model support and browserToolEnabled
			const testCases = [
				{ modelSupports: true, settingEnabled: true, expected: true },
				{ modelSupports: true, settingEnabled: false, expected: false },
				{ modelSupports: false, settingEnabled: true, expected: false },
				{ modelSupports: false, settingEnabled: false, expected: false },
			]

			for (const testCase of testCases) {
				// Reset mocks
				systemPromptSpy.mockClear()

				// Update mock Cline instance
				mockCline.api.getModel = jest.fn().mockReturnValue({
					id: "test-model",
					info: { supportsComputerUse: testCase.modelSupports },
				})

				// Mock getState
				jest.spyOn(provider, "getState").mockResolvedValue({
					apiConfiguration: {
						apiProvider: "openrouter",
					},
					browserToolEnabled: testCase.settingEnabled,
					mode: "code",
					experiments: experimentDefault,
				} as any)

				// Trigger getSystemPrompt
				const handler = getMessageHandler()
				await handler({ type: "getSystemPrompt", mode: "code" })

				// Verify SYSTEM_PROMPT was called
				expect(systemPromptSpy).toHaveBeenCalled()

				// Get the actual arguments passed to SYSTEM_PROMPT
				const callArgs = systemPromptSpy.mock.calls[0]

				// Verify the supportsComputerUse parameter (3rd parameter, index 2)
				expect(callArgs[2]).toBe(testCase.expected)
			}
		})
	})

	describe("handleModeSwitch", () => {
		beforeEach(async () => {
			// Set up webview for each test
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("loads saved API config when switching modes", async () => {
			// Mock ConfigManager methods
			provider.configManager = {
				getModeConfigId: jest.fn().mockResolvedValue("saved-config-id"),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "saved-config", id: "saved-config-id", apiProvider: "anthropic" }]),
				loadConfig: jest.fn().mockResolvedValue({ apiProvider: "anthropic" }),
				setModeConfig: jest.fn(),
			} as any

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify saved config was loaded
			expect(provider.configManager.getModeConfigId).toHaveBeenCalledWith("architect")
			expect(provider.configManager.loadConfig).toHaveBeenCalledWith("saved-config")
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "saved-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("saves current config when switching to mode without config", async () => {
			// Mock ConfigManager methods
			provider.configManager = {
				getModeConfigId: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
				setModeConfig: jest.fn(),
			} as any

			// Mock current config name
			mockContext.globalState.get = jest.fn((key: string) => {
				if (key === "currentApiConfigName") return "current-config"
				return undefined
			})

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify current config was saved as default for new mode
			expect(provider.configManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})
	})

	describe("updateCustomMode", () => {
		test("updates both file and state when updating custom mode", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock CustomModesManager methods
			provider.customModesManager = {
				updateCustomMode: jest.fn().mockResolvedValue(undefined),
				getCustomModes: jest.fn().mockResolvedValue({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Updated role definition",
							groups: ["read"] as const,
						},
					],
				}),
				dispose: jest.fn(),
			} as any

			// Test updating a custom mode
			await messageHandler({
				type: "updateCustomMode",
				modeConfig: {
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Updated role definition",
					groups: ["read"] as const,
				},
			})

			// Verify CustomModesManager.updateCustomMode was called
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledWith(
				"test-mode",
				expect.objectContaining({
					slug: "test-mode",
					roleDefinition: "Updated role definition",
				}),
			)

			// Verify state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", {
				customModes: [
					expect.objectContaining({
						slug: "test-mode",
						roleDefinition: "Updated role definition",
					}),
				],
			})

			// Verify state was posted to webview
			// Verify state was posted to webview with correct format
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "state",
					state: expect.objectContaining({
						customModes: {
							customModes: [
								expect.objectContaining({
									slug: "test-mode",
									roleDefinition: "Updated role definition",
								}),
							],
						},
					}),
				}),
			)
		})
	})

	describe("upsertApiConfiguration", () => {
		test("handles error in upsertApiConfiguration gracefully", async () => {
			provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock ConfigManager methods to simulate error
			provider.configManager = {
				setModeConfig: jest.fn().mockRejectedValue(new Error("Failed to update mode config")),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Mock getState to provide necessary data
			jest.spyOn(provider, "getState").mockResolvedValue({
				mode: "code",
				currentApiConfigName: "test-config",
			} as any)

			// Trigger updateApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: {
					apiProvider: "anthropic",
					apiKey: "test-key",
				},
			})

			// Verify error was logged and user was notified
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to create api configuration")
		})

		test("handles successful upsertApiConfiguration", async () => {
			provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock ConfigManager methods
			provider.configManager = {
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.configManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("handles buildApiHandler error in updateApiConfiguration", async () => {
			provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock buildApiHandler to throw an error
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementationOnce(() => {
				throw new Error("API handler error")
			})

			// Mock ConfigManager methods
			provider.configManager = {
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Setup Cline instance with auto-mock from the top of the file
			const { Cline } = require("../../Cline") // Get the mocked class
			const mockCline = new Cline() // Create a new mocked instance
			await provider.addClineToStack(mockCline)

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify error handling
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to create api configuration")

			// Verify state was still updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
		})

		test("handles successful saveApiConfiguration", async () => {
			provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock ConfigManager methods
			provider.configManager = {
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "saveApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.configManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
		})
	})

	describe("browser connection features", () => {
		beforeEach(async () => {
			// Reset mocks
			jest.clearAllMocks()
			await provider.resolveWebviewView(mockWebviewView)
		})

		// Mock BrowserSession and discoverChromeInstances
		jest.mock("../../../services/browser/BrowserSession", () => ({
			BrowserSession: jest.fn().mockImplementation(() => ({
				testConnection: jest.fn().mockImplementation(async (url) => {
					if (url === "http://localhost:9222") {
						return {
							success: true,
							message: "Successfully connected to Chrome",
							endpoint: "ws://localhost:9222/devtools/browser/123",
						}
					} else {
						return {
							success: false,
							message: "Failed to connect to Chrome",
							endpoint: undefined,
						}
					}
				}),
			})),
		}))

		jest.mock("../../../services/browser/browserDiscovery", () => ({
			discoverChromeInstances: jest.fn().mockImplementation(async () => {
				return "http://localhost:9222"
			}),
		}))

		test("handles testBrowserConnection with provided URL", async () => {
			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test with valid URL
			await messageHandler({
				type: "testBrowserConnection",
				text: "http://localhost:9222",
			})

			// Verify postMessage was called with success result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: true,
					text: expect.stringContaining("Successfully connected to Chrome"),
				}),
			)

			// Reset mock
			mockPostMessage.mockClear()

			// Test with invalid URL
			await messageHandler({
				type: "testBrowserConnection",
				text: "http://inlocalhost:9222",
			})

			// Verify postMessage was called with failure result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: false,
					text: expect.stringContaining("Failed to connect to Chrome"),
				}),
			)
		})

		test("handles testBrowserConnection with auto-discovery", async () => {
			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test auto-discovery (no URL provided)
			await messageHandler({
				type: "testBrowserConnection",
			})

			// Verify discoverChromeInstances was called
			const { discoverChromeInstances } = require("../../../services/browser/browserDiscovery")
			expect(discoverChromeInstances).toHaveBeenCalled()

			// Verify postMessage was called with success result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: true,
					text: expect.stringContaining("Auto-discovered and tested connection to Chrome"),
				}),
			)
		})

		test("handles discoverBrowser message", async () => {
			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test browser discovery
			await messageHandler({
				type: "discoverBrowser",
			})

			// Verify discoverChromeInstances was called
			const { discoverChromeInstances } = require("../../../services/browser/browserDiscovery")
			expect(discoverChromeInstances).toHaveBeenCalled()

			// Verify postMessage was called with success result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: true,
					text: expect.stringContaining("Successfully discovered and connected to Chrome"),
				}),
			)
		})

		test("handles errors during browser discovery", async () => {
			// Mock discoverChromeInstances to throw an error
			const { discoverChromeInstances } = require("../../../services/browser/browserDiscovery")
			discoverChromeInstances.mockImplementationOnce(() => {
				throw new Error("Discovery error")
			})

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test browser discovery with error
			await messageHandler({
				type: "discoverBrowser",
			})

			// Verify postMessage was called with error result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: false,
					text: expect.stringContaining("Error discovering browser"),
				}),
			)
		})

		test("handles case when no browsers are discovered", async () => {
			// Mock discoverChromeInstances to return null (no browsers found)
			const { discoverChromeInstances } = require("../../../services/browser/browserDiscovery")
			discoverChromeInstances.mockImplementationOnce(() => null)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test browser discovery with no browsers found
			await messageHandler({
				type: "discoverBrowser",
			})

			// Verify postMessage was called with failure result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: false,
					text: expect.stringContaining("No Chrome instances found"),
				}),
			)
		})
	})
})

describe("ContextProxy integration", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: any
	let mockGlobalStateUpdate: jest.Mock

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		provider = new ClineProvider(mockContext, mockOutputChannel)

		// @ts-ignore - accessing private property for testing
		mockContextProxy = provider.contextProxy

		mockGlobalStateUpdate = mockContext.globalState.update as jest.Mock
	})

	test("updateGlobalState uses contextProxy", async () => {
		await provider.updateGlobalState("currentApiConfigName" as GlobalStateKey, "testValue")
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("currentApiConfigName", "testValue")
	})

	test("getGlobalState uses contextProxy", async () => {
		mockContextProxy.getGlobalState.mockResolvedValueOnce("testValue")
		const result = await provider.getGlobalState("currentApiConfigName" as GlobalStateKey)
		expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("currentApiConfigName")
		expect(result).toBe("testValue")
	})

	test("storeSecret uses contextProxy", async () => {
		await provider.storeSecret("apiKey" as SecretKey, "test-secret")
		expect(mockContextProxy.storeSecret).toHaveBeenCalledWith("apiKey", "test-secret")
	})

	test("contextProxy methods are available", () => {
		// Verify the contextProxy has all the required methods
		expect(mockContextProxy.getGlobalState).toBeDefined()
		expect(mockContextProxy.updateGlobalState).toBeDefined()
		expect(mockContextProxy.storeSecret).toBeDefined()
		expect(mockContextProxy.setValue).toBeDefined()
		expect(mockContextProxy.setValues).toBeDefined()
	})
})

describe("getTelemetryProperties", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockCline: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn().mockImplementation((key: string) => {
					if (key === "mode") return "code"
					if (key === "apiProvider") return "anthropic"
					return undefined
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		provider = new ClineProvider(mockContext, mockOutputChannel)

		// Setup Cline instance with mocked getModel method
		const { Cline } = require("../../Cline")
		mockCline = new Cline()
		mockCline.api = {
			getModel: jest.fn().mockReturnValue({
				id: "claude-3-7-sonnet-20250219",
				info: { contextWindow: 200000 },
			}),
		}
	})

	test("includes basic properties in telemetry", async () => {
		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("vscodeVersion")
		expect(properties).toHaveProperty("platform")
		expect(properties).toHaveProperty("appVersion", "1.0.0")
	})

	test("includes model ID from current Cline instance if available", async () => {
		// Add mock Cline to stack
		await provider.addClineToStack(mockCline)

		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("modelId", "claude-3-7-sonnet-20250219")
	})
})
