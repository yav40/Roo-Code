import * as vscode from "vscode"
import * as dotenvx from "@dotenvx/dotenvx"

// Load environment variables from .env file
try {
	// Specify path to .env file in the project root directory
	const envPath = __dirname + "/../.env"
	dotenvx.config({ path: envPath })
} catch (e) {
	// Silently handle environment loading errors
	console.warn("Failed to load environment variables:", e)
}

import { ClineProvider } from "./core/webview/ClineProvider"
import { createClineAPI } from "./exports"
import "./utils/path" // Necessary to have access to String.prototype.toPosix.
import { CodeActionProvider } from "./core/CodeActionProvider"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { handleUri, registerCommands, registerCodeActions, registerTerminalActions } from "./activate"
import { McpServerManager } from "./services/mcp/McpServerManager"
import { telemetryService } from "./services/telemetry/TelemetryService"
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext

// Callback mapping of human relay response
const humanRelayCallbacks = new Map<string, (response: string | undefined) => void>()

/**
 * Register a callback function for human relay response
 * @param requestId
 * @param callback
 */
export function registerHumanRelayCallback(requestId: string, callback: (response: string | undefined) => void): void {
	humanRelayCallbacks.set(requestId, callback)
}

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel("Roo-Code")
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine("Roo-Code extension activated")

	// Initialize telemetry service after environment variables are loaded
	telemetryService.initialize()
	// Initialize terminal shell execution handlers
	TerminalRegistry.initialize()

	// Get default commands from configuration.
	const defaultCommands = vscode.workspace.getConfiguration("roo-cline").get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}
	const sidebarProvider = new ClineProvider(context, outputChannel)
	telemetryService.setProvider(sidebarProvider)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	registerCommands({ context, outputChannel, provider: sidebarProvider })

	// Register human relay callback registration command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"roo-cline.registerHumanRelayCallback",
			(requestId: string, callback: (response: string | undefined) => void) => {
				registerHumanRelayCallback(requestId, callback)
			},
		),
	)

	// Register human relay response processing command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"roo-cline.handleHumanRelayResponse",
			(response: { requestId: string; text?: string; cancelled?: boolean }) => {
				const callback = humanRelayCallbacks.get(response.requestId)
				if (callback) {
					if (response.cancelled) {
						callback(undefined)
					} else {
						callback(response.text)
					}
					humanRelayCallbacks.delete(response.requestId)
				}
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("roo-cline.unregisterHumanRelayCallback", (requestId: string) => {
			humanRelayCallbacks.delete(requestId)
		}),
	)

	/**
	 * We use the text document content provider API to show the left side for diff
	 * view by creating a virtual document for the original content. This makes it
	 * readonly so users know to edit the right side if they want to keep their changes.
	 *
	 * This API allows you to create readonly documents in VSCode from arbitrary
	 * sources, and works by claiming an uri-scheme for which your provider then
	 * returns text contents. The scheme must be provided when registering a
	 * provider and cannot change afterwards.
	 *
	 * Note how the provider doesn't create uris for virtual documents - its role
	 * is to provide contents given such an uri. In return, content providers are
	 * wired into the open document logic so that providers are always considered.
	 *
	 * https://code.visualstudio.com/api/extension-guides/virtual-documents
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	registerCodeActions(context)
	registerTerminalActions(context)

	return createClineAPI(outputChannel, sidebarProvider)
}

// This method is called when your extension is deactivated
export async function deactivate() {
	outputChannel.appendLine("Roo-Code extension deactivated")
	// Clean up MCP server manager
	await McpServerManager.cleanup(extensionContext)
	telemetryService.shutdown()

	// Clean up terminal handlers
	TerminalRegistry.cleanup()
}
