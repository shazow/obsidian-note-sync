import {App, MarkdownView, Notice, Plugin, TFile, parseYaml, requestUrl, stringifyYaml} from "obsidian";
import {DEFAULT_SETTINGS, NoteSyncSettingTab, NoteSyncSettings} from "./settings";

interface IssueRef {
	owner: string;
	repo: string;
	number: number;
}

interface IssueData {
	title?: string;
	body?: string;
	state?: string;
	labels?: { name?: string }[];
	assignees?: { login?: string }[];
	milestone?: { title?: string } | null;
	html_url?: string;
	updated_at?: string;
}

interface NoteParts {
	frontmatter: Record<string, unknown>;
	body: string;
}

export default class NoteSyncPlugin extends Plugin {
	settings: NoteSyncSettings;
	private headerActions: HTMLElement[] = [];

	async onload() {
		this.settings = await this.loadSettings();

		this.addSettingTab(new NoteSyncSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			this.refreshActions(file ?? this.app.workspace.getActiveFile());
		}));

		this.registerEvent(this.app.metadataCache.on("changed", (file) => {
			const active = this.app.workspace.getActiveFile();
			if (active && file?.path === active.path) {
				this.refreshActions(active);
			}
		}));

		this.addCommand({
			id: "note-sync-pull",
			name: "Sync note pull",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const syncValue = file ? getSyncValue(this.app, file) : null;
				if (!syncValue || !file) {
					return false;
				}
				if (!checking) {
					const syncUrl = getSyncUrl(this.app, file);
					if (!syncUrl) {
						new Notice("Invalid sync URL.");
						return true;
					}
					void this.pullIssue(file, syncUrl);
				}
				return true;
			},
		});

		this.addCommand({
			id: "note-sync-push",
			name: "Sync note push",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const syncValue = file ? getSyncValue(this.app, file) : null;
				if (!syncValue || !file) {
					return false;
				}
				if (!checking) {
					const syncUrl = getSyncUrl(this.app, file);
					if (!syncUrl) {
						new Notice("Invalid sync URL.");
						return true;
					}
					void this.pushIssue(file, syncUrl);
				}
				return true;
			},
		});

		this.refreshActions(this.app.workspace.getActiveFile());
	}

	onunload() {
		this.clearActions();
	}

	private async loadSettings(): Promise<NoteSyncSettings> {
		const data: unknown = await this.loadData();
		const persisted = (isRecord(data) ? data : {}) as Partial<NoteSyncSettings>;
		return Object.assign({}, DEFAULT_SETTINGS, persisted);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private clearActions() {
		this.headerActions.forEach((el) => el.remove());
		this.headerActions = [];
	}

	private refreshActions(file?: TFile | null) {
		this.clearActions();
		const targetFile = file ?? this.app.workspace.getActiveFile();
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!targetFile || !view || !view.file || view.file.path !== targetFile.path) {
			return;
		}

		const syncUrl = getSyncUrl(this.app, targetFile);
		if (!syncUrl) {
			return;
		}

		this.headerActions.push(
			view.addAction("download-cloud", "Pull issue", () => this.pullIssue(targetFile, syncUrl)),
			view.addAction("upload-cloud", "Push issue", () => this.pushIssue(targetFile, syncUrl)),
		);
	}

	private async pullIssue(file: TFile, syncUrl: string) {
		const ref = parseIssueUrl(syncUrl);
		if (!ref) {
			new Notice("Invalid sync URL.");
			return;
		}

		try {
			const issue = await fetchIssue(ref, this.settings.githubToken);
			await writeIssueToNote(this.app, file, syncUrl, ref, issue);
			new Notice("Pulled issue into note.");
			this.refreshActions(file);
		} catch (error) {
			notifyError("pull issue", error);
		}
	}

	private async pushIssue(file: TFile, syncUrl: string) {
		if (!this.settings.githubToken) {
			new Notice("Set GitHub auth token in settings to push.");
			return;
		}

		const ref = parseIssueUrl(syncUrl);
		if (!ref) {
			new Notice("Invalid sync URL.");
			return;
		}

		try {
			const {body} = await readNoteParts(this.app, file);
			await pushIssueBody(ref, body, this.settings.githubToken);
			new Notice("Pushed note to issue.");
		} catch (error) {
			notifyError("push issue", error);
		}
	}

	async isGhAvailable(): Promise<boolean> {
		try {
			/* eslint-disable import/no-nodejs-modules */
			const {execFile} = await import("node:child_process");
			const {promisify} = await import("node:util");
			/* eslint-enable import/no-nodejs-modules */
			const execFileAsync = promisify(execFile);
			await execFileAsync("gh", ["--version"]);
			return true;
		} catch {
			return false;
		}
	}

	async fetchTokenFromGh(): Promise<string | null> {
		try {
			/* eslint-disable import/no-nodejs-modules */
			const {execFile} = await import("node:child_process");
			const {promisify} = await import("node:util");
			/* eslint-enable import/no-nodejs-modules */
			const execFileAsync = promisify(execFile);
			const {stdout} = await execFileAsync("gh", ["auth", "token"], {encoding: "utf8"});
			const token = stdout.trim();
			return token || null;
		} catch (error) {
			console.error("Note Sync: gh token fetch failed", error);
			return null;
		}
	}
}

function getSyncUrl(app: App, file: TFile): string | null {
	const syncValue = getSyncValue(app, file);
	if (!syncValue) {
		return null;
	}
	if (!syncValue.startsWith("https://github.com/") || !syncValue.includes("/issues/")) {
		return null;
	}
	return syncValue;
}

function getSyncValue(app: App, file: TFile): string | null {
	const cache = app.metadataCache.getFileCache(file);
	const raw = isRecord(cache?.frontmatter) ? cache?.frontmatter?.sync : undefined;
	if (typeof raw !== "string") {
		return null;
	}
	const trimmed = raw.trim();
	return trimmed;
}

function parseIssueUrl(url: string): IssueRef | null {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i.exec(url.trim());
	if (!match) {
		return null;
	}

	const owner = match[1] as string;
	const repo = match[2] as string;
	const issueNumber = match[3] as string;
	return {
		owner,
		repo,
		number: Number(issueNumber),
	};
}

async function fetchIssue(ref: IssueRef, token: string): Promise<IssueData> {
	const url = issueApiUrl(ref);
	const response = await githubRequest<IssueData>(url, "GET", token);
	return response;
}

async function pushIssueBody(ref: IssueRef, body: string, token: string) {
	const url = issueApiUrl(ref);
	await githubRequest<unknown>(url, "PATCH", token, {body});
}

async function githubRequest<T>(url: string, method: "GET" | "PATCH", token: string, payload?: unknown): Promise<T> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await requestUrl({
		url,
		method,
		body: payload ? JSON.stringify(payload) : undefined,
		headers,
		contentType: payload ? "application/json" : undefined,
		throw: false,
	});

	if (response.status >= 400) {
		const message = extractErrorMessage(response);
		throw new Error(message);
	}

	return response.json as T;
}

function issueApiUrl(ref: IssueRef): string {
	return `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
}

async function writeIssueToNote(app: App, file: TFile, syncUrl: string, ref: IssueRef, issue: IssueData) {
	const parts = await readNoteParts(app, file);
	const cleanedFrontmatter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parts.frontmatter)) {
		if (key === "position") {
			continue;
		}
		if (key === "sync") {
			cleanedFrontmatter.sync = value;
			continue;
		}
		cleanedFrontmatter[key] = value;
	}

	cleanedFrontmatter.sync = cleanedFrontmatter.sync ?? syncUrl;

	const nextFrontmatter: Record<string, unknown> = {
		...cleanedFrontmatter,
		title: issue.title,
		state: issue.state,
		issue: ref.number,
		repository: `${ref.owner}/${ref.repo}`,
		issue_url: issue.html_url ?? syncUrl,
		updated: issue.updated_at,
		labels: (issue.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)),
		assignees: (issue.assignees ?? []).map((assignee) => assignee.login).filter((login): login is string => Boolean(login)),
		milestone: issue.milestone?.title,
	};

	for (const key of Object.keys(nextFrontmatter)) {
		const value = nextFrontmatter[key];
		if (value === undefined || value === null) {
			delete nextFrontmatter[key];
		}
		if (Array.isArray(value) && value.length === 0) {
			delete nextFrontmatter[key];
		}
	}

	const content = buildNoteContent(nextFrontmatter, issue.body ?? "");
	await app.vault.modify(file, content);
}

async function readNoteParts(app: App, file: TFile): Promise<NoteParts> {
	const content = await app.vault.read(file);
	const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/m.exec(content);
	if (!match) {
		return {frontmatter: {}, body: content};
	}

	const [, frontmatterBlock = "", body = ""] = match;
	const parsedFrontmatter = parseYaml(frontmatterBlock) as unknown;
	const frontmatter = isRecord(parsedFrontmatter) ? parsedFrontmatter : {};
	return {frontmatter, body};
}

function buildNoteContent(frontmatter: Record<string, unknown>, body: string): string {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	const normalizedBody = body.replace(/\s+$/, "") + "\n";
	return `---\n${yaml}\n---\n\n${normalizedBody}`;
}

function notifyError(action: string, error: unknown) {
	console.error(`Note Sync: failed to ${action}`, error);
	const message = error instanceof Error ? error.message : String(error);
	new Notice(`Note Sync: Failed to ${action}. ${message}`);
}

function extractErrorMessage(response: { status: number; text?: string; json?: unknown }): string {
	const fallback = `GitHub API error (${response.status})`;
	if (!response.text) {
		return fallback;
	}

	try {
		const parsed = JSON.parse(response.text) as { message?: string };
		return parsed.message || fallback;
	} catch {
		return response.text || fallback;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
