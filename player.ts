export class Player {
    id: number;
    username: string;
    // money: number;
    ready: boolean;
    isWaitingForConnect: boolean;
    isDisconnect: boolean;

    constructor(id: number, username: string) {
        this.id = id;
        this.username = username;
        // this.money = 100000000;
        this.ready = false;
        this.isWaitingForConnect = false;
        this.isDisconnect = false;
    }
}
