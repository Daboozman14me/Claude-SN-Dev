import { EmailNotification } from '@servicenow/sdk/core'

export const confirmed = EmailNotification({
    $id: Now.ID['demo-confirmed'],
    name: 'Demo - Item Confirmed',
    table: 'x_1_demo_item',
    triggerConditions: { generationType: 'event', eventName: 'x_1_demo.item.confirmed' },
    recipientDetails: { recipientFields: ['owner'] },
    emailContent: {
        contentType: 'text/html',
        subject: 'Item ${number} confirmed',
        messageHtml: [
            '<p>Your item ${number} is confirmed.</p>',
            '<p>Owner: ${owner}</p>',
        ].join('\n'),
    },
})
