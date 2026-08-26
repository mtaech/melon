/**
 * Browser half of dsh-plugin-dashboard: a "插件版本" tab under
 * Settings → Plugins. JSX-free (createElement only) so the bundle needs no
 * JSX transform. Data + mutations come through injected callbacks that hit
 * the host half's /plugins/dsh-plugin-dashboard/api routes on the same origin.
 */
import React, { useEffect, useState } from "react";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime, InjectFace } from "@deepseek-ai/dsh-client-ui-slots";

const ROUTE_PREFIX = "/plugins/dsh-plugin-dashboard/api";

/** JSON contract mirrored from the host half (kept local; wire-only). */
export interface PluginEntryDto {
	name: string;
	mounted: boolean;
	isCore: boolean;
	source: string;
	specifier: string;
	installedVersion: string | null;
	installedCommit: string | null;
	description?: string;
	latest: { label: string; targetCommit: string | null; error: string | null } | null;
	status: "update-available" | "up-to-date" | "not-installed" | "ahead" | "unknown" | "n-a";
	upgradeable: boolean;
	url?: string | null;
}

export interface UpgradePlanDto {
	name: string;
	source: string;
	installedVersion: string | null;
	installedCommit: string | null;
	currentSpecifier: string;
	targetLabel: string;
	targetCommit: string | null;
	newSpecifier: string;
	command: string;
	wouldChange: boolean;
	currentVersionDate?: string | null;
	latestVersionDate?: string | null;
	error?: string;
}

type TabProps = PropsRuntime<"settings.plugins.tab"> & InjectFace<DashboardTabInjected>;

export interface UninstallPlanDto {
	name: string;
	isCore: boolean;
	inDependencies: boolean;
	inBundles: boolean;
	wouldRemove: boolean;
	error?: string;
}

interface DashboardTabInjected {
	list: () => Promise<{ dshRunning: boolean; plugins: PluginEntryDto[] }>;
	plan: (name: string) => Promise<UpgradePlanDto>;
	apply: (name: string, plan: UpgradePlanDto) => Promise<{ applied: boolean; log: string[]; error?: string }>;
	uninstall: (name: string, apply: boolean) => Promise<{ plan?: UninstallPlanDto; applied: boolean; log: string[]; error?: string }>;
}

const S = {
	card: { background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "var(--m3-shape-medium)", padding: "12px 14px", marginBottom: 10, display: "flex", flexDirection: "column" as const, gap: 8 },
	row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const },
	name: { fontWeight: 600, wordBreak: "break-all" as const, color: "var(--dsw-alias-label-primary)" },
	badge: { fontSize: 11, padding: "1px 8px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-secondary)", background: "var(--dsw-alias-interactive-bg-hover-solid)" },
	badgeGit: { color: "var(--dsw-alias-brand-primary)", borderColor: "var(--dsw-alias-state-business-tertiary)" },
	badgeNpm: { color: "var(--dsw-alias-state-success-primary)", borderColor: "var(--dsw-alias-state-success-tertiary)" },
	badgeCore: { color: "var(--dsw-alias-label-tertiary)", background: "var(--dsw-alias-bg-layer-1)" },
	badgeMounted: { color: "var(--dsw-alias-brand-text)", borderColor: "var(--dsw-alias-state-business-tertiary)" },
	badgeUp: { color: "var(--dsw-alias-state-warn-primary)", borderColor: "var(--dsw-alias-state-warn-tertiary)" },
	desc: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, minHeight: "1em" },
	vers: { display: "flex", justifyContent: "space-between", color: "var(--dsw-alias-label-secondary)", fontSize: 13 },
	versB: { color: "var(--dsw-alias-label-primary)", fontWeight: 500 },
	pill: { fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-secondary)", marginLeft: "auto" as const },
	pillOk: { color: "var(--dsw-alias-state-success-primary)", borderColor: "var(--dsw-alias-state-success-tertiary)" },
	pillAvail: { color: "var(--dsw-alias-state-warn-primary)", borderColor: "var(--dsw-alias-state-warn-tertiary)", fontWeight: 600 },
	actions: { display: "flex", gap: 8 },
	btn: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "var(--m3-shape-small)", padding: "6px 10px", cursor: "pointer", background: "var(--dsw-alias-button-floating-fill)", color: "var(--dsw-alias-label-primary)", fontSize: 13 },
	btnPrimary: { background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", borderColor: "transparent" },
	btnDanger: { background: "var(--dsw-alias-button-floating-fill)", color: "var(--dsw-alias-state-error-primary)", borderColor: "var(--dsw-alias-state-error-secondary)" },
	link: { color: "var(--dsw-alias-brand-text)", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" as const },
	btnDisabled: { opacity: 0.45, cursor: "not-allowed" as const },
	modalWrap: { position: "fixed" as const, inset: 0, background: "var(--dsw-alias-bg-mask-2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 },
	modal: { background: "var(--dsw-alias-bg-layer-3)", border: "1px solid var(--dsw-alias-border-l3)", borderRadius: "var(--m3-shape-large)", maxWidth: 620, width: "100%" as const, maxHeight: "80vh", display: "flex", flexDirection: "column" as const },
	modalHead: { fontSize: 16, padding: "14px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-primary)" },
	modalBody: { padding: "14px 16px", overflowY: "auto" as const },
	plan: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 13 },
	planDt: { color: "var(--dsw-alias-label-tertiary)" },
	planDd: { wordBreak: "break-all" as const, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
	log: { background: "var(--dsw-alias-markdown-code-block)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "var(--m3-shape-small)", padding: 10, font: "12px/1.45 ui-monospace, monospace", maxHeight: 220, overflow: "auto" as const, whiteSpace: "pre-wrap" as const, marginTop: 10, color: "var(--dsw-alias-label-secondary)" },
	modalFoot: { display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--dsw-alias-border-l2)", justifyContent: "flex-end" },
	banner: { background: "var(--dsw-alias-state-warn-tertiary)", border: "1px solid var(--dsw-alias-state-warn-primary)", color: "var(--dsw-alias-state-warn-label)", padding: "8px 12px", borderRadius: "var(--m3-shape-small)", marginBottom: 12 },
	empty: { color: "var(--dsw-alias-label-tertiary)", padding: 24, textAlign: "center" as const },
	header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, color: "var(--dsw-alias-label-primary)" },
	search: { flex: 1, minWidth: 180, background: "var(--dsw-alias-bg-layer-1)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "var(--m3-shape-small)", padding: "6px 10px", color: "var(--dsw-alias-label-primary)", fontSize: 13 },
	searchBox: { display: "flex", alignItems: "center", flex: 1, minWidth: 180, gap: 4, background: "var(--dsw-alias-bg-layer-1)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "var(--m3-shape-small)", padding: "6px 10px" },
	clear: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", cursor: "pointer", fontSize: 14, padding: "4px 6px", borderRadius: "var(--m3-shape-small)", display: "inline-flex", lineHeight: 1 },
};

function short(s: string | null | undefined): string {
	return s ? s.slice(0, 7) : "";
}

function dateLabel(d: string | null | undefined): string {
	return d ? d.slice(0, 10) : "—";
}

const STATUS_PILL: Record<string, [string, React.CSSProperties]> = {
	"update-available": ["可升级", S.pillAvail],
	"not-installed": ["未安装", S.pillAvail],
	"up-to-date": ["最新", S.pillOk],
	ahead: ["超前", undefined!],
	unknown: ["未知", undefined!],
	"n-a": ["n/a", undefined!],
};

function Pill({ status }: { status: string }): React.ReactElement {
	const [label, style] = STATUS_PILL[status] ?? ["?", undefined];
	return React.createElement("span", { style: { ...S.pill, ...(style ?? {}) } }, label);
}

interface CardProps {
	entry: PluginEntryDto;
	onUpgrade: (name: string) => void;
	onUninstall: (name: string) => void;
}

function Card({ entry, onUpgrade, onUninstall }: CardProps): React.ReactElement {
	const badges: React.ReactElement[] = [];
	if (entry.isCore) badges.push(React.createElement("span", { key: "core", style: S.badge }, "core"));
	if (entry.mounted) badges.push(React.createElement("span", { key: "mounted", style: S.badge }, "mounted"));
	const sourceStyle = entry.source === "git" ? S.badgeGit : entry.source === "npm" ? S.badgeNpm : undefined;
	badges.push(React.createElement("span", { key: "src", style: { ...S.badge, ...sourceStyle } }, entry.source));
	if (entry.installedCommit) badges.push(React.createElement("span", { key: "commit", style: S.badge, title: entry.installedCommit }, short(entry.installedCommit)));
	if (entry.upgradeable) badges.push(React.createElement("span", { key: "up", style: { ...S.badge, ...S.badgeUp } }, entry.status === "not-installed" ? "未安装" : "有新版本"));

	let button: React.ReactElement;
	if (entry.upgradeable) {
		button = React.createElement("button", { style: { ...S.btn, ...S.btnPrimary }, onClick: () => onUpgrade(entry.name) }, "升级");
	} else if (entry.status === "n-a" || entry.status === "unknown") {
		button = React.createElement("button", { style: { ...S.btn, ...S.btnDisabled }, disabled: true, title: entry.latest?.error ?? "" }, "n/a");
	} else {
		button = React.createElement("button", { style: { ...S.btn, ...S.btnDisabled }, disabled: true }, "已最新");
	}
	const uninstallBtn = entry.isCore
		? null
		: React.createElement("button", { style: { ...S.btn, ...S.btnDanger }, onClick: () => onUninstall(entry.name) }, "卸载");

	const latest = entry.latest?.label ?? "?";
	return React.createElement(
		"div",
		{ style: S.card },
		React.createElement(
			"div",
			{ style: S.row },
			React.createElement("span", { style: S.name }, entry.name),
			...badges,
			React.createElement(Pill, { status: entry.status }),
		),
		React.createElement("div", { style: S.desc }, entry.description ?? ""),
		React.createElement(
			"div",
			{ style: S.vers },
			React.createElement("span", null, "installed ", React.createElement("b", { style: S.versB }, entry.installedVersion ?? "—")),
			React.createElement("span", null, "latest ", React.createElement("b", { style: S.versB }, latest)),
		),
		React.createElement("div", { style: S.actions },
		entry.url ? React.createElement("a", { href: entry.url, target: "_blank", rel: "noreferrer", style: S.link, title: entry.url }, "仓库 ↗") : null,
		button,
		uninstallBtn,
	),
	);
}

interface ModalState {
	entry: PluginEntryDto;
	plan: UpgradePlanDto | null;
	log: string[];
	busy: boolean;
	done: boolean;
}

const EMPTY_MODAL: ModalState = { entry: undefined as unknown as PluginEntryDto, plan: null, log: [], busy: false, done: false };

function DashboardTab(props: TabProps): React.ReactElement {
	const [entries, setEntries] = useState<PluginEntryDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dshRunning, setDshRunning] = useState(false);
	const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);
	const [open, setOpen] = useState(false);
	const [uninstallState, setUninstallState] = useState<{ entry: PluginEntryDto; plan: UninstallPlanDto | null; log: string[]; busy: boolean; done: boolean } | null>(null);
	const [query, setQuery] = useState("");

	const reload = (): void => {
		setLoading(true);
		setError(null);
		props.list()
			.then((data) => {
				setEntries(data.plugins);
				setDshRunning(data.dshRunning);
			})
			.catch((e: Error) => setError(e.message))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		reload();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!open && modal.done) {
			setModal(EMPTY_MODAL);
			reload();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, modal.done]);

	const openUpgrade = (name: string): void => {
		const entry = entries.find((e) => e.name === name);
		if (!entry) return;
		setModal({ entry, plan: null, log: [], busy: true, done: false });
		setOpen(true);
		props.plan(name).then((plan) => setModal((m) => ({ ...m, plan, busy: false }))).catch((e: Error) => {
			setModal((m) => ({ ...m, plan: { name, source: "", installedVersion: null, installedCommit: null, currentSpecifier: "", targetLabel: "", targetCommit: null, newSpecifier: "", command: "", wouldChange: false, error: e.message }, busy: false }));
		});
	};

	const doApply = (): void => {
		if (!modal.plan) return;
		setModal((m) => ({ ...m, busy: true }));
		props.apply(modal.entry.name, modal.plan).then((out) => {
			setModal((m) => ({ ...m, busy: false, done: out.applied, log: out.log }));
		}).catch((e: Error) => {
			setModal((m) => ({ ...m, busy: false, log: [...m.log, `失败：${e.message}`] }));
		});
	};

	const q = query.trim().toLocaleLowerCase();
	const visible = q
		? entries.filter((e) => e.name.toLocaleLowerCase().includes(q) || (e.description ?? "").toLocaleLowerCase().includes(q))
		: entries;

	const close = (): void => setOpen(false);

	const openUninstall = (name: string): void => {
		const entry = entries.find((e) => e.name === name);
		if (!entry) return;
		setUninstallState({ entry, plan: null, log: [], busy: true, done: false });
		props.uninstall(name, false).then((out) => {
			setUninstallState((u) => (u ? { ...u, plan: out.plan ?? null, busy: false } : u));
		}).catch((e: Error) => {
			setUninstallState((u) => (u ? { ...u, plan: { name, isCore: false, inDependencies: false, inBundles: false, wouldRemove: false, error: e.message }, busy: false } : u));
		});
	};

	const doUninstall = (): void => {
		if (!uninstallState?.entry) return;
		setUninstallState((u) => (u ? { ...u, busy: true } : u));
		props.uninstall(uninstallState.entry.name, true).then((out) => {
			setUninstallState((u) => (u ? { ...u, busy: false, done: out.applied, log: out.log, plan: out.plan ?? u.plan } : u));
		}).catch((e: Error) => {
			setUninstallState((u) => (u ? { ...u, busy: false, log: [...u.log, `失败：${e.message}`] } : u));
		});
	};

	const closeUninstall = (): void => {
		setUninstallState(null);
		reload();
	};

	return React.createElement(
		"div",
		null,
		dshRunning ? React.createElement("div", { style: S.banner }, "⚠ dsh 正在运行：升级会改动 profile 的 node_modules，请先停止 dsh 再应用升级。") : null,
		React.createElement(
			"div",
			{ style: S.header },
			React.createElement("strong", null, `插件管理（${visible.length}）`),
			React.createElement("div", { style: S.searchBox },
				React.createElement("input", { style: { ...S.search, border: "none", padding: 0, flex: 1, minWidth: 0, background: "transparent", outline: "none" }, placeholder: "搜索插件…", value: query, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value) }),
				query ? React.createElement("button", { style: S.clear, onClick: () => setQuery(""), title: "清除搜索", type: "button" }, "×") : null,
			),
			React.createElement("button", { style: S.btn, onClick: reload }, "刷新"),
		),
		loading
			? React.createElement("div", { style: S.empty }, "查询 npm registry + git 远端…")
			: error
				? React.createElement("div", { style: S.empty }, `加载失败：${error}`)
				: visible.length === 0
					? React.createElement("div", { style: S.empty }, q ? "无匹配插件" : "无插件")
					: React.createElement("div", null, visible.map((e) => React.createElement(Card, { key: e.name, entry: e, onUpgrade: openUpgrade, onUninstall: openUninstall }))),
		open ? React.createElement(UpgradeModal, { modal, onClose: close, onApply: doApply }) : null,
		uninstallState ? React.createElement(UninstallModal, { state: uninstallState, onClose: closeUninstall, onApply: doUninstall }) : null,
	);
}

function UpgradeModal({ modal, onClose, onApply }: { modal: ModalState; onClose: () => void; onApply: () => void }): React.ReactElement {
	const plan = modal.plan;
	const rows: Array<[string, React.ReactNode]> = [];
	if (plan) {
		rows.push(
			["来源", plan.source],
			["当前", `${plan.installedVersion ?? "—"}${plan.installedCommit ? ` (${short(plan.installedCommit)})` : ""}`],
			["当前版本日期", dateLabel(plan.currentVersionDate)],
			["目标", plan.targetLabel],
			["最新版本日期", dateLabel(plan.latestVersionDate)],
			["旧 specifier", plan.currentSpecifier],
			["新 specifier", plan.newSpecifier],
		);
		if (plan.error) rows.push(["错误", plan.error]);
		else rows.push(["命令", React.createElement("code", null, plan.command)]);
	}
	const canApply = plan != null && !plan.error && !modal.busy && !modal.done;
	return React.createElement("div", { style: S.modalWrap, onClick: onClose },
		React.createElement("div", { style: S.modal, onClick: (e: React.MouseEvent) => e.stopPropagation() },
			React.createElement("div", { style: S.modalHead }, `升级 ${modal.entry.name}`),
			React.createElement("div", { style: S.modalBody },
				React.createElement("dl", { style: S.plan },
					...rows.flatMap(([k, v]) => [
						React.createElement("dt", { key: k + "-k", style: S.planDt }, k),
						React.createElement("dd", { key: k + "-v", style: S.planDd }, v),
					]),
				),
				modal.log.length > 0 ? React.createElement("pre", { style: S.log }, modal.log.join("\n")) : null,
			),
			React.createElement("div", { style: S.modalFoot },
				React.createElement("button", { style: S.btn, onClick: onClose }, modal.done ? "关闭" : "取消"),
				React.createElement("button", { style: { ...S.btn, ...S.btnPrimary, ...(canApply ? {} : S.btnDisabled) }, disabled: !canApply, onClick: onApply, title: canApply ? "" : plan?.error ? plan.error : "已是最新" },
					modal.busy ? "执行 pnpm install…" : modal.done ? "已应用 ✓ 请重启 dsh" : "应用升级"),
			),
		),
	);
}

/** Services the browser plugin needs: the slots registry (settings tab contribution). */
export const inject = ["slots"];

export function apply(ctx: ClientContext): void {
	const api = `${ROUTE_PREFIX}`;
	const list = async (): Promise<{ dshRunning: boolean; plugins: PluginEntryDto[] }> => {
		const res = await fetch(`${api}/list`);
		const body = (await res.json()) as { dshRunning: boolean; plugins: PluginEntryDto[] } & { error?: string };
		if (!res.ok) throw new Error(body.error ?? `list failed (${res.status})`);
		return body;
	};
	const plan = async (name: string): Promise<UpgradePlanDto> => {
		const res = await fetch(`${api}/upgrade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
		const body = (await res.json()) as { plan: UpgradePlanDto } & { error?: string };
		if (!res.ok) throw new Error(body.error ?? `plan failed (${res.status})`);
		return body.plan;
	};
	const apply = async (name: string, _plan: UpgradePlanDto): Promise<{ applied: boolean; log: string[]; error?: string }> => {
		const res = await fetch(`${api}/upgrade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, apply: true }) });
		const body = (await res.json()) as { applied: boolean; log: string[]; error?: string } & { error?: string };
		if (!res.ok) throw new Error(body.error ?? `upgrade failed (${res.status})`);
		return body;
	};
	const uninstall = async (name: string, applyNow: boolean): Promise<{ plan?: UninstallPlanDto; applied: boolean; log: string[]; error?: string }> => {
		const res = await fetch(`${api}/uninstall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, apply: applyNow }) });
		const body = (await res.json()) as { plan?: UninstallPlanDto; applied: boolean; log: string[]; error?: string } & { error?: string };
		if (!res.ok) throw new Error(body.error ?? `uninstall failed (${res.status})`);
		return body;
	};
	const injected = (): DashboardTabInjected => ({ list, plan, apply, uninstall });

	if (!ctx.slots) return;
	ctx.slots.inject("settings.plugins.tab", () =>
		ctx.slots.register({
			name: "settings.plugins.tab",
			id: "plugin-versions",
			order: 20,
			label: () => "插件管理",
			inject: injected,
		}, DashboardTab),
	);
}
function UninstallModal({ state, onClose, onApply }: { state: { entry: PluginEntryDto; plan: UninstallPlanDto | null; log: string[]; busy: boolean; done: boolean }; onClose: () => void; onApply: () => void }): React.ReactElement {
	const plan = state.plan;
	const rows: Array<[string, React.ReactNode]> = [];
	if (plan) {
		rows.push(["影响范围", `${plan.inDependencies ? "dependencies + " : ""}${plan.inBundles ? "bundles 挂载" : ""}`]);
		if (plan.error) rows.push(["错误", plan.error]);
		else rows.push(["提示", "pnpm remove 后从 bundles 移除挂载；卸载后需要重启 dsh 生效"]);
	}
	const canApply = plan != null && !plan.error && !state.busy && !state.done;
	return React.createElement("div", { style: S.modalWrap, onClick: onClose },
		React.createElement("div", { style: { ...S.modal, borderColor: "#6e2c2c" }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
			React.createElement("div", { style: S.modalHead }, `卸载 ${state.entry.name}`),
			React.createElement("div", { style: S.modalBody },
				React.createElement("dl", { style: S.plan },
					...rows.flatMap(([k, v]) => [
						React.createElement("dt", { key: k + "-k", style: S.planDt }, k),
						React.createElement("dd", { key: k + "-v", style: S.planDd }, v),
					]),
				),
				state.log.length > 0 ? React.createElement("pre", { style: S.log }, state.log.join("\n")) : null,
			),
			React.createElement("div", { style: S.modalFoot },
				React.createElement("button", { style: S.btn, onClick: onClose }, state.done ? "关闭" : "取消"),
				React.createElement("button", { style: { ...S.btn, ...S.btnDanger, ...(canApply ? {} : S.btnDisabled) }, disabled: !canApply, onClick: onApply, title: canApply ? "" : plan?.error ?? "" },
					state.busy ? "执行 pnpm remove…" : state.done ? "已卸载 ✓ 请重启 dsh" : "确认卸载"),
			),
		),
	);
}
