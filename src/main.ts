import {App, MarkdownView, Notice, Plugin, TFile, parseYaml, stringifyYaml} from "obsidian";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import {join} from "node:path";

interface IssueData {
	title?: string;
	body?: string;
	number?: number;
	state?: string;
	labels?: {name?: string}[];
	assignees?: {login?: string}[];
	milestone?: {title?: string} | null;
	repository?: {nameWithOwner?: string};
	url?: string;
	updatedAt?: string;
}

interface NoteParts {
	frontmatter: Record<string, unknown>;
	body: string;
}

const execFileAsync = promisify(execFile);

export default class NoteSyncPlugin extends Plugin {
	private headerActions: HTMLElement[] = [];

	async onload() {
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
				name: "Pull sync source",
				checkCallback: (checking) => {
					const file = this.app.workspace.getActiveFile();
					const syncUrl = file ? getSyncUrl(this.app, file) : null;
					if (!syncUrl || !file) {
						return false;
					}
					if (!checking) {
						void this.pullIssue(file, syncUrl);
					}
					return true;
				},
			});

			this.addCommand({
				id: "note-sync-push",
				name: "Push to sync source",
				checkCallback: (checking) => {
					const file = this.app.workspace.getActiveFile();
					const syncUrl = file ? getSyncUrl(this.app, file) : null;
					if (!syncUrl || !file) {
						return false;
					}
					if (!checking) {
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
		try {
			const issue = await fetchIssue(syncUrl);
			await writeIssueToNote(this.app, file, syncUrl, issue);
			new Notice("Pulled issue into note.");
			this.refreshActions(file);
		} catch (error) {
			notifyError("pull issue", error);
		}
	}

	private async pushIssue(file: TFile, syncUrl: string) {
		try {
			const {body} = await readNoteParts(this.app, file);
			await pushIssueBody(syncUrl, body);
			new Notice("Pushed note to issue.");
		} catch (error) {
			notifyError("push issue", error);
		}
	}
}

function getSyncUrl(app: App, file: TFile): string | null {
	const cache = app.metadataCache.getFileCache(file);
	const raw = isRecord(cache?.frontmatter) ? cache?.frontmatter?.sync : undefined;
	if (typeof raw !== "string") {
		return null;
	}
	const trimmed = raw.trim();
	if (!trimmed.startsWith("https://github.com/") || !trimmed.includes("/issues/")) {
		return null;
	}
	return trimmed;
}

async function fetchIssue(syncUrl: string): Promise<IssueData> {
	const fields = [
		"title",
		"body",
		"number",
		"state",
		"labels",
		"assignees",
		"milestone",
		"repository",
		"url",
		"updatedAt",
	];
	const stdout = await runGh(["issue", "view", syncUrl, "--json", fields.join(",")]);
	return JSON.parse(stdout) as IssueData;
}

async function pushIssueBody(syncUrl: string, body: string) {
	const tempDir = await mkdtemp(join(os.tmpdir(), "obsidian-note-sync-"));
	const bodyPath = join(tempDir, "body.md");
	try {
		await writeFile(bodyPath, body, "utf8");
		await runGh(["issue", "edit", syncUrl, "--body-file", bodyPath]);
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
}

async function writeIssueToNote(app: App, file: TFile, syncUrl: string, issue: IssueData) {
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

	const nextFrontmatter = {
		...cleanedFrontmatter,
		title: issue.title,
		state: issue.state,
		issue: issue.number,
		repository: issue.repository?.nameWithOwner,
		issue_url: issue.url ?? syncUrl,
		updated: issue.updatedAt,
		labels: (issue.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)),
		assignees: (issue.assignees ?? []).map((assignee) => assignee.login).filter((login): login is string => Boolean(login)),
		milestone: issue.milestone?.title,
	};

	for (const key of Object.keys(nextFrontmatter)) {
		const value = (nextFrontmatter as Record<string, unknown>)[key];
		if (value === undefined || value === null) {
			delete (nextFrontmatter as Record<string, unknown>)[key];
		}
		if (Array.isArray(value) && value.length === 0) {
			delete (nextFrontmatter as Record<string, unknown>)[key];
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

async function runGh(args: string[]): Promise<string> {
	try {
		const {stdout} = await execFileAsync("gh", args, {encoding: "utf8"});
		return stdout.trim();
	} catch (error: unknown) {
		const stderr = typeof error === "object" && error && "stderr" in error
			? String((error as {stderr?: string}).stderr ?? "").trim()
			: "";
		const message = typeof error === "object" && error && "message" in error
			? String((error as {message?: string}).message ?? "")
			: "";
		throw new Error(stderr || message || "gh command failed");
	}
}

function notifyError(action: string, error: unknown) {
	console.error(`Note Sync: failed to ${action}`, error);
	const message = error instanceof Error ? error.message : String(error);
	new Notice(`Note Sync: Failed to ${action}. ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
