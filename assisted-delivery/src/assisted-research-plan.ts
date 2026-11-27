export interface AssistedArtifactQueryDefinition {
  category: string;
  table: string;
  fields: readonly string[];
  selection:
    | "application_scope"
    | "application_tables"
    | "parent_inventory_records";
  fallbackTables?: readonly string[];
  /** Encoded-query clauses every read of this table must append (for example, excluding secrets). */
  requiredFilter?: string;
}

export const ASSISTED_APPLICATION_ARTIFACT_QUERIES: readonly AssistedArtifactQueryDefinition[] =
  [
    {
      category: "tables",
      table: "sys_db_object",
      fields: ["sys_id", "name", "label", "super_class"],
      selection: "application_scope",
    },
    {
      category: "dictionary_fields",
      table: "sys_dictionary",
      fields: [
        "sys_id",
        "name",
        "element",
        "column_label",
        "internal_type",
        "reference",
        "mandatory",
        "read_only",
        "default_value",
      ],
      selection: "application_tables",
    },
    {
      category: "business_rules",
      table: "sys_script",
      fields: [
        "sys_id",
        "name",
        "collection",
        "when",
        "active",
        "order",
        "condition",
        "filter_condition",
        "action_insert",
        "action_update",
        "action_delete",
        "action_query",
        "abort_action",
        "advanced",
        "script",
        "sys_updated_on",
      ],
      selection: "application_scope",
    },
    {
      category: "client_scripts",
      table: "sys_script_client",
      fallbackTables: ["sys_client_script"],
      fields: ["sys_id", "name", "table", "type", "active", "condition", "script"],
      selection: "application_scope",
    },
    {
      category: "script_includes",
      table: "sys_script_include",
      fields: [
        "sys_id",
        "name",
        "api_name",
        "active",
        "client_callable",
        "script",
      ],
      selection: "application_scope",
    },
    {
      category: "ui_policies",
      table: "sys_ui_policy",
      fields: ["sys_id", "short_description", "table", "active", "conditions", "on_load", "reverse_if_false", "run_scripts", "script_true", "script_false"],
      selection: "application_scope",
    },
    {
      category: "ui_policy_actions",
      table: "sys_ui_policy_action",
      fields: ["sys_id", "ui_policy", "table", "field", "visible", "mandatory", "disabled", "cleared", "value_action", "value"],
      selection: "parent_inventory_records",
    },
    {
      category: "ui_actions",
      table: "sys_ui_action",
      fields: ["sys_id", "name", "table", "active", "client", "condition", "script"],
      selection: "application_scope",
    },
    {
      category: "acls",
      table: "sys_security_acl",
      fields: ["sys_id", "name", "operation", "type", "active", "condition", "script"],
      selection: "application_scope",
    },
    {
      category: "acl_roles",
      table: "sys_security_acl_role",
      fields: ["sys_id", "sys_security_acl", "sys_user_role"],
      selection: "parent_inventory_records",
    },
    {
      category: "roles",
      table: "sys_user_role",
      fields: ["sys_id", "name", "description"],
      selection: "application_scope",
    },
    {
      category: "flows",
      table: "sys_hub_flow",
      fields: ["sys_id", "name", "active", "type", "status", "run_as", "description"],
      selection: "application_scope",
    },
    // Flow structure: trigger, ordered actions, and logic blocks. Their input values (conditions, field
    // values) live in the compressed flow snapshot and come back empty, so research reports that limit.
    {
      category: "flow_triggers",
      table: "sys_hub_trigger_instance",
      fields: ["sys_id", "flow", "name", "trigger_type", "trigger_definition", "display_text"],
      selection: "parent_inventory_records",
    },
    {
      category: "flow_actions",
      table: "sys_hub_action_instance",
      fields: ["sys_id", "flow", "action_type", "order", "comment"],
      selection: "parent_inventory_records",
    },
    {
      category: "flow_logic",
      table: "sys_hub_flow_logic",
      fields: ["sys_id", "flow", "logic_definition", "order", "comment"],
      selection: "parent_inventory_records",
    },
    {
      category: "workflows",
      table: "wf_workflow",
      fields: ["sys_id", "name", "table", "active"],
      selection: "application_scope",
    },
    {
      category: "scripted_rest_apis",
      table: "sys_ws_definition",
      fields: ["sys_id", "name", "namespace", "service_id", "active"],
      selection: "application_scope",
    },
    {
      category: "scripted_rest_operations",
      table: "sys_ws_operation",
      fields: ["sys_id", "name", "web_service_definition", "http_method", "relative_path", "script"],
      selection: "parent_inventory_records",
    },
    {
      category: "rest_messages",
      table: "sys_rest_message",
      fields: ["sys_id", "name", "endpoint"],
      selection: "application_scope",
    },
    {
      category: "scheduled_jobs",
      table: "sysauto_script",
      fields: ["sys_id", "name", "active", "run_type", "script"],
      selection: "application_scope",
    },
    {
      category: "properties",
      table: "sys_properties",
      fields: ["sys_id", "name", "value", "type", "description"],
      selection: "application_scope",
      requiredFilter: "type!=password^type!=password2",
    },
    {
      category: "transform_maps",
      table: "sys_transform_map",
      fields: ["sys_id", "name", "source_table", "target_table", "active", "run_script", "script"],
      selection: "application_tables",
    },
    {
      category: "transform_field_maps",
      table: "sys_transform_entry",
      fields: ["sys_id", "map", "source_field", "target_field", "coalesce", "use_source_script", "source_script"],
      selection: "parent_inventory_records",
    },
    {
      category: "fix_scripts",
      table: "sys_script_fix",
      fields: ["sys_id", "name", "active", "run_start", "script"],
      selection: "application_scope",
    },
    {
      category: "email_notifications",
      table: "sysevent_email_action",
      fields: [
        "sys_id",
        "name",
        "collection",
        "active",
        "generation_type",
        "event_name",
        "action_insert",
        "action_update",
        "condition",
        "advanced_condition",
        "recipient_fields",
        "recipient_groups",
        "recipient_users",
        "send_self",
        "subject",
        "message_html",
      ],
      selection: "application_scope",
    },
    {
      category: "event_registry",
      table: "sysevent_register",
      fields: ["sys_id", "event_name", "table", "fired_by"],
      selection: "application_scope",
    },
    {
      category: "inbound_email_actions",
      table: "sysevent_in_email_action",
      fields: ["sys_id", "name", "event_name", "table_name", "active", "script"],
      selection: "application_scope",
    },
    {
      category: "ui_scripts",
      table: "sys_ui_script",
      fields: ["sys_id", "name", "script_name", "active", "global", "ui_type", "script"],
      selection: "application_scope",
    },
    {
      category: "ui_pages",
      table: "sys_ui_page",
      fields: ["sys_id", "name", "category", "html", "client_script", "processing_script"],
      selection: "application_scope",
    },
    {
      category: "data_policies",
      table: "sys_data_policy2",
      fields: ["sys_id", "short_description", "model_table", "conditions", "active", "enforce_ui", "apply_import_set", "apply_soap"],
      selection: "application_scope",
    },
    {
      category: "data_policy_rules",
      table: "sys_data_policy_rule",
      fields: ["sys_id", "sys_data_policy", "table", "field", "mandatory", "disabled"],
      selection: "parent_inventory_records",
    },
    {
      category: "script_actions",
      table: "sysevent_script_action",
      fields: ["sys_id", "sys_name", "event_name", "active", "synchronous", "condition_script", "script"],
      selection: "application_scope",
    },
  ] as const;
