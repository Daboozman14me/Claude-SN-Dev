import { join } from "node:path";

export function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    appForm: "fluent",
    appLocation: { kind: "local_project", path: "C:\\projects\\new-app" },
    target: { application: "New App", scope: "x_2054821_ncrb", instanceAlias: "dev292961" },
    changeSource: { kind: "stories", description: "EPIC-0 stories from the story draft." },
    runScope: "ST-0.1 only.",
    knownDifferences: [] as Array<{ id: string; table: string; records: string; reason: string }>,
    confirmedAt: "2026-11-07T17:55:00.000Z",
    ...overrides,
  };
}

export function currentState(overrides: Record<string, unknown> = {}) {
  return { method: "local_project", parity: "matches", checks: [], ...overrides };
}

export function classicWorkOrder(changeKind: "findings" | "request" | "stories" = "findings") {
  return workOrder({
    appForm: "classic",
    appLocation: { kind: "instance", instanceAlias: "dev292961" },
    target: { application: "Conference Room Booking", scope: "x_2054821_confer_0", instanceAlias: "dev292961" },
    changeSource: {
      kind: changeKind,
      description:
        changeKind === "findings"
          ? "Approved findings F-001 and F-002 from code-review-v001."
          : "Add a Building field to Room.",
    },
    runScope: changeKind === "findings" ? "F-001 and F-002." : "The Building field only.",
  });
}

export function scriptDeliverables(scriptsDirectory: string, kind: "background_script" | "fix_script", count = 2) {
  const deliverables: any[] = [];
  for (let index = 1; index <= count; index += 1) {
    const id = `D-${String(index * 2 - 1).padStart(2, "0")}`;
    const rollbackId = `D-${String(index * 2).padStart(2, "0")}`;
    const findingId = `F-${String(index).padStart(3, "0")}`;
    deliverables.push(
      {
        id,
        kind,
        title: `Apply ${findingId}`,
        path: join(scriptsDirectory, `${String(index).padStart(2, "0")}-apply-${findingId.toLowerCase()}.js`),
        sha256: "c".repeat(64),
        order: index,
        applicationScope: "x_2054821_confer_0",
        updateSetGuidance: "Select the 'CRB review fixes' update set.",
        targets: [{ table: "sys_script", name: "Reservation - Set Defaults", field: "script" }],
        implements: [{ kind: "finding", id: findingId }],
      },
      {
        id: rollbackId,
        kind: "rollback_script",
        title: `Undo ${findingId}`,
        path: join(scriptsDirectory, `${String(index).padStart(2, "0")}-rollback-${findingId.toLowerCase()}.js`),
        sha256: "d".repeat(64),
        order: 100 + index,
        applicationScope: "x_2054821_confer_0",
        rollbackFor: id,
        targets: [{ table: "sys_script", name: "Reservation - Set Defaults", field: "script" }],
        implements: [{ kind: "finding", id: findingId }],
      },
    );
  }
  if (count > 1) {
    deliverables.push({
      id: `D-${String(count * 2 + 1).padStart(2, "0")}`,
      kind: "readme",
      title: "How to apply",
      path: join(scriptsDirectory, "README.md"),
      sha256: "e".repeat(64),
      targets: [],
      implements: [],
    });
  }
  return deliverables;
}
