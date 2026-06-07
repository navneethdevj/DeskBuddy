export declare const SOCKET_EVENTS: {
    readonly JOIN_WORKSPACE: "workspace:join";
    readonly LEAVE_WORKSPACE: "workspace:leave";
    readonly TASK_CREATED: "task:created";
    readonly TASK_UPDATED: "task:updated";
    readonly TASK_DELETED: "task:deleted";
    readonly NOTE_CREATED: "note:created";
    readonly NOTE_UPDATED: "note:updated";
    readonly NOTE_DELETED: "note:deleted";
    readonly USER_PRESENCE: "presence:update";
    readonly USER_JOINED: "presence:joined";
    readonly USER_LEFT: "presence:left";
};
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
//# sourceMappingURL=socket-events.d.ts.map