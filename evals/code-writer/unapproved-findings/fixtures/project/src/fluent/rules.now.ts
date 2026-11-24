import { BusinessRule } from '@servicenow/sdk/core'

export const setDefaults = BusinessRule({
    $id: Now.ID['demo-set-defaults'],
    name: 'Demo - Set Defaults',
    table: 'x_1_demo_item',
    when: 'before',
    action: ['insert'],
    script: Now.include('../server/set-defaults.server.js'),
})
