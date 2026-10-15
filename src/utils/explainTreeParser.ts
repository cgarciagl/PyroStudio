import type { ExplainNode, ExplainPlanTreeNode, ExplainRow } from "../types/database";

/**
 * Builds a hierarchical ExplainPlanTreeNode tree from either:
 * 1. MySQL / MariaDB EXPLAIN FORMAT=JSON payload
 * 2. Fallback: Tabular ExplainRow[] / ExplainNode[]
 */
export function buildExplainTree(params: {
  jsonPlan?: any;
  visualNodes?: ExplainNode[];
  executionPlan?: ExplainRow[];
}): ExplainPlanTreeNode {
  const { jsonPlan, visualNodes, executionPlan } = params;

  // 1. Try parsing from JSON Plan if valid
  if (jsonPlan && typeof jsonPlan === "object") {
    const rootBlock = jsonPlan.query_block || jsonPlan;
    if (rootBlock && typeof rootBlock === "object") {
      const parsed = parseQueryBlock(rootBlock, "root-1");
      if (parsed) return parsed;
    }
  }

  // 2. Fallback: Parse from structured executionPlan / visualNodes
  if (visualNodes && visualNodes.length > 0) {
    return buildTreeFromVisualNodes(visualNodes);
  }

  if (executionPlan && executionPlan.length > 0) {
    return buildTreeFromExplainRows(executionPlan);
  }

  // 3. Fallback: Empty node
  return {
    id: "empty",
    name: "Sin pasos de ejecución",
    operationType: "other",
    flags: [],
    children: [],
  };
}

/**
 * Parses MySQL / MariaDB optimizer JSON query_block into an ExplainPlanTreeNode.
 */
function parseQueryBlock(block: any, id: string): ExplainPlanTreeNode | null {
  if (!block || typeof block !== "object") return null;

  const cost = block.cost_info?.query_cost;
  const selectId = block.select_id !== undefined ? String(block.select_id) : undefined;

  const rootNode: ExplainPlanTreeNode = {
    id: `qb-${id}`,
    name: selectId ? `Query Block (SELECT #${selectId})` : "Query Block (SELECT)",
    operationType: "query_block",
    cost: cost ? `Cost: ${cost}` : undefined,
    flags: [],
    children: [],
  };

  // Inspect wrappers: ordering_operation, grouping_operation, duplicates_removal, etc.
  let currentParent = rootNode;

  if (block.ordering_operation) {
    const op = block.ordering_operation;
    const flags: string[] = [];
    if (op.using_filesort) flags.push("Using filesort");
    const sortNode: ExplainPlanTreeNode = {
      id: `${id}-order`,
      name: "Sort Operation",
      operationType: "ordering",
      cost: op.cost_info?.sort_cost ? `Sort Cost: ${op.cost_info.sort_cost}` : undefined,
      flags,
      children: [],
    };
    currentParent.children.push(sortNode);
    currentParent = sortNode;
    unwrapInnerOperations(op, currentParent, `${id}-order`);
  } else if (block.grouping_operation) {
    const op = block.grouping_operation;
    const flags: string[] = [];
    if (op.using_filesort) flags.push("Using filesort");
    if (op.using_temporary_table) flags.push("Using temporary table");
    const groupNode: ExplainPlanTreeNode = {
      id: `${id}-group`,
      name: "Grouping / Aggregate",
      operationType: "grouping",
      cost: op.cost_info?.sort_cost ? `Cost: ${op.cost_info.sort_cost}` : undefined,
      flags,
      children: [],
    };
    currentParent.children.push(groupNode);
    currentParent = groupNode;
    unwrapInnerOperations(op, currentParent, `${id}-group`);
  } else {
    unwrapInnerOperations(block, currentParent, id);
  }

  // Inspect subqueries if any
  if (Array.isArray(block.subqueries)) {
    block.subqueries.forEach((sq: any, idx: number) => {
      const subBlock = sq.query_block || sq;
      const subNode = parseQueryBlock(subBlock, `${id}-sq-${idx}`);
      if (subNode) {
        rootNode.children.push({
          ...subNode,
          name: `Subquery: ${subNode.name}`,
          operationType: "subquery",
        });
      }
    });
  }

  return rootNode;
}

function unwrapInnerOperations(container: any, parent: ExplainPlanTreeNode, id: string) {
  // Nested Loop
  if (Array.isArray(container.nested_loop)) {
    const joinNode: ExplainPlanTreeNode = {
      id: `${id}-nl`,
      name: "Nested Loop Join",
      operationType: "nested_loop",
      flags: [],
      children: [],
    };
    parent.children.push(joinNode);

    container.nested_loop.forEach((step: any, idx: number) => {
      if (step.table) {
        const tblNode = parseTableObject(step.table, `${id}-nl-${idx}`);
        if (tblNode) joinNode.children.push(tblNode);
      } else if (step.grouping_operation) {
        unwrapInnerOperations(step, joinNode, `${id}-nl-${idx}`);
      }
    });
    return;
  }

  // Direct Table
  if (container.table) {
    const tblNode = parseTableObject(container.table, `${id}-tbl`);
    if (tblNode) parent.children.push(tblNode);
    return;
  }

  // Union
  if (container.union_result) {
    const union = container.union_result;
    const unionNode: ExplainPlanTreeNode = {
      id: `${id}-union`,
      name: union.table_name || "<union_result>",
      operationType: "union",
      flags: union.using_temporary_table ? ["Using temporary table"] : [],
      children: [],
    };
    if (Array.isArray(union.query_specifications)) {
      union.query_specifications.forEach((qs: any, idx: number) => {
        const qb = qs.query_block || qs;
        const sub = parseQueryBlock(qb, `${id}-u-${idx}`);
        if (sub) unionNode.children.push(sub);
      });
    }
    parent.children.push(unionNode);
  }
}

function parseTableObject(table: any, id: string): ExplainPlanTreeNode {
  const access = (table.access_type || "ALL").toUpperCase();
  const tableName = table.table_name || "—";
  const keyUsed = table.key && table.key !== "NULL" ? table.key : undefined;
  const possible = Array.isArray(table.possible_keys)
    ? table.possible_keys
    : typeof table.possible_keys === "string"
    ? [table.possible_keys]
    : undefined;

  let opType: ExplainPlanTreeNode["operationType"] = "table";
  if (access === "ALL") opType = "table_scan";
  else if (access === "INDEX") opType = "index_scan";
  else if (access === "RANGE") opType = "range_scan";
  else if (access === "REF" || access === "EQ_REF" || access === "CONST") opType = "index_scan";

  const flags: string[] = [];
  if (table.using_index) flags.push("Using index (Covering)");
  if (table.using_filesort) flags.push("Using filesort");
  if (table.using_temporary_table) flags.push("Using temporary");
  if (table.attached_condition) flags.push("Attached condition");

  const cost = table.cost_info?.eval_cost || table.cost_info?.read_cost;

  const node: ExplainPlanTreeNode = {
    id,
    name: `${opType === "table_scan" ? "Full Table Scan" : opType === "range_scan" ? "Index Range Scan" : "Index Lookup"} on ${tableName}`,
    operationType: opType,
    tableName,
    accessType: access,
    keyUsed,
    possibleKeys: possible,
    keyLen: table.key_length,
    refColumns: Array.isArray(table.ref) ? table.ref : table.ref ? [table.ref] : undefined,
    rowsExamined: Number(table.rows_examined_per_scan) || undefined,
    rowsProduced: Number(table.rows_produced_per_join) || undefined,
    filteredPercent: table.filtered !== undefined ? Number(table.filtered) : undefined,
    cost: cost ? `Cost: ${cost}` : undefined,
    flags,
    condition: table.attached_condition,
    children: [],
  };

  // Check materialized subqueries inside table
  if (table.materialized_from_subquery) {
    const subQ = table.materialized_from_subquery.query_block || table.materialized_from_subquery;
    const subNode = parseQueryBlock(subQ, `${id}-mat`);
    if (subNode) {
      node.children.push({
        ...subNode,
        name: `Materialized Subquery: ${subNode.name}`,
        operationType: "subquery",
      });
    }
  }

  return node;
}

/**
 * Builds tree from tabular visual nodes
 */
function buildTreeFromVisualNodes(nodes: ExplainNode[]): ExplainPlanTreeNode {
  const rootNode: ExplainPlanTreeNode = {
    id: "root-visual",
    name: "Query Execution Plan",
    operationType: "query_block",
    flags: [],
    children: [],
  };

  // Group nodes by select_type or query id
  const hasMultiple = nodes.length > 1;
  let targetParent = rootNode;

  if (hasMultiple) {
    const joinNode: ExplainPlanTreeNode = {
      id: "join-root",
      name: "Nested Loop / Join Pipeline",
      operationType: "nested_loop",
      flags: [],
      children: [],
    };
    rootNode.children.push(joinNode);
    targetParent = joinNode;
  }

  nodes.forEach((vn) => {
    const access = vn.access_type.toUpperCase();
    let opType: ExplainPlanTreeNode["operationType"] = "table";
    if (access === "ALL") opType = "table_scan";
    else if (access === "INDEX") opType = "index_scan";
    else if (access === "RANGE") opType = "range_scan";
    else if (access === "REF" || access === "EQ_REF" || access === "CONST") opType = "index_scan";

    const label =
      opType === "table_scan"
        ? `Full Table Scan on ${vn.table_name}`
        : opType === "range_scan"
        ? `Index Range Scan on ${vn.table_name}`
        : access === "CONST"
        ? `Constant Lookup on ${vn.table_name}`
        : `Index Access (${access}) on ${vn.table_name}`;

    targetParent.children.push({
      id: `vn-${vn.id}`,
      name: label,
      operationType: opType,
      tableName: vn.table_name,
      accessType: access,
      keyUsed: vn.key && vn.key !== "NULL" ? vn.key : undefined,
      possibleKeys: vn.possible_keys,
      keyLen: vn.key_len,
      refColumns: vn.ref_columns,
      rowsExamined: vn.estimated_rows,
      filteredPercent: vn.filtered_percent,
      flags: vn.flags || [],
      condition: vn.attached_condition,
      children: [],
    });
  });

  return rootNode;
}

/**
 * Builds tree from tabular ExplainRow array
 */
function buildTreeFromExplainRows(rows: ExplainRow[]): ExplainPlanTreeNode {
  const rootNode: ExplainPlanTreeNode = {
    id: "root-rows",
    name: "Query Execution Plan",
    operationType: "query_block",
    flags: [],
    children: [],
  };

  const hasMultiple = rows.length > 1;
  let targetParent = rootNode;

  if (hasMultiple) {
    const joinNode: ExplainPlanTreeNode = {
      id: "join-root-rows",
      name: "Join Pipeline",
      operationType: "nested_loop",
      flags: [],
      children: [],
    };
    rootNode.children.push(joinNode);
    targetParent = joinNode;
  }

  rows.forEach((r, idx) => {
    const access = (r.type || "ALL").toUpperCase();
    let opType: ExplainPlanTreeNode["operationType"] = "table";
    if (access === "ALL") opType = "table_scan";
    else if (access === "INDEX") opType = "index_scan";
    else if (access === "RANGE") opType = "range_scan";
    else if (access === "REF" || access === "EQ_REF" || access === "CONST") opType = "index_scan";

    const flags: string[] = [];
    if (r.extra) {
      if (r.extra.includes("Using filesort")) flags.push("Using filesort");
      if (r.extra.includes("Using temporary")) flags.push("Using temporary");
      if (r.extra.includes("Using index")) flags.push("Using index (Covering)");
      if (r.extra.includes("Using where")) flags.push("Using where");
    }

    const possible = r.possible_keys
      ? r.possible_keys.split(",").map((k) => k.trim()).filter(Boolean)
      : undefined;

    targetParent.children.push({
      id: `row-${idx + 1}`,
      name: `${opType === "table_scan" ? "Full Table Scan" : "Index Access"} on ${r.table}`,
      operationType: opType,
      tableName: r.table,
      accessType: access,
      keyUsed: r.key && r.key !== "NULL" ? r.key : undefined,
      possibleKeys: possible,
      keyLen: r.key_len,
      refColumns: r.ref ? [r.ref] : undefined,
      rowsExamined: r.rows,
      filteredPercent: r.filtered,
      flags,
      children: [],
    });
  });

  return rootNode;
}

