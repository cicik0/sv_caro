import { checkWin, randomMakeMove, sendAllInfoRoom, setOutRoomTimer } from "./utils"
import { Player } from "./player"
import { getConnectionByUserId, sendToClient, WebSocketUserData } from "./server"
import { start } from "repl"


export class Room {
    id: string
    name: string
    board: number[][]
    players: Player[]
    orderOfPlayer: number[]
    turn: number //turn là  chỉ số của người chơi trong mảng players, turn luôn là 0, thay đổi giữa 0 và 1.
    turnStartTime: number
    currentTurnTimout: NodeJS.Timeout | null;
    bet: string
    gameStarted: boolean
    gameDelay: boolean
    boardSize: number
    gameStartTimeout: NodeJS.Timeout | null

    constructor(id: string, name: string, boardSize: number, bet: string) {
        this.id = id
        this.name = name
        this.boardSize = boardSize
        this.bet = bet
        this.board = Array.from({ length: boardSize }, () =>
            Array.from({ length: boardSize }, () => -1),
        )
        this.players = []
        this.orderOfPlayer = [];
        this.turn = 0;
        this.turnStartTime = 0;
        this.currentTurnTimout = null;
        this.gameStarted = false
        this.gameDelay = false
        this.gameStartTimeout = null
    }

    addPlayer(player: Player): void {
        this.players.push(player)
        if (this.players.length === 2 && !this.gameStarted) {
            this.startGameAfterDelay(5000) // 5 seconds
        }
    }

    removePlayer(playerId: number): void {
        this.players = this.players.filter((player) => player.id !== playerId)
        if (this.players.length < 2 && this.gameStartTimeout) {
            clearTimeout(this.gameStartTimeout)
            this.gameStartTimeout = null
        }
    }

    setPlayerReady(playerId: number): void {
        const player = this.players.find((p) => p.id === playerId)
        if (player) {
            player.ready = true
        }
    }

    canStartGame(): boolean {
        return this.players.length === 2 && this.players.every((p) => p.ready)
    }

    startGame(): void {
        this.resetBoad();
        this.gameStarted = true;
        this.turnStartTime = Date.now();
    }

    startGameAfterDelay(delay: number): void {
        this.gameStartTimeout = setTimeout(() => {
            if (this.players.length === 2) {
                this.gameStarted = true
                this.players.forEach((player) => {
                    player.ready = true
                })
            }
        }, delay)
    }

    getPlayerIndex(playerId: number): number {
        return this.players.findIndex((p) => p.id === playerId)
    }

    makeMove(x: number, y: number, playerIndex: number): boolean {
        // console.log("current cell: ", this.board[x][y]);
        
        if (this.board[x][y] === -1) {
            this.board[x][y] = playerIndex
            return true
        }
        return false
    }

    resetBoad() {
        const boardSize = 15;
        this.board = Array.from({ length: boardSize }, () =>
            Array.from({ length: boardSize }, () => -1),
        )
        // this.gameStarted = false;
        this.turn = 0;
        this.orderOfPlayer = [];
        // this.gameDelay = false;
    }

    // xu li khi player ket noi lai
    reconnectPlayer(playerId) {
        const connectAgainTime = Date.now();
        const elapsed = connectAgainTime - this.turnStartTime;
        const remainingTime = Math.max(0, 15000 - elapsed);
        const remainingTimePercent = remainingTime == 0? 0: remainingTime/15000;
        console.log("connect again: ", connectAgainTime);
        console.log("turnStartTime: ", this.turnStartTime);    
        console.log("elapsed: ", elapsed);
        console.log("remaining: ", remainingTime/1000);
        console.log("remainingPercent: ", remainingTimePercent);
        

        const roomInfo = {
            type: "connectRoomAgain",
            roomId: this.id,
            roomName: this.name,
            roomBet: this.bet,
            players: this.players.map(p => ({ id: p.id, username: p.username })),
            board: this.board,
            gameStarted: this.gameStarted,
            playerNameTurn: this.players[this.turn].username,
            remainingTimePercent: remainingTimePercent,
        }
        const playerReconnect = this.players.find((p) => p.id === playerId);
        if(playerReconnect){
            playerReconnect.isDisconnect = false;
            playerReconnect.isWaitingForConnect = true;
            // console.log("check player reconnect: ", playerReconnect.username);
            
        }
        // console.log(roomInfo.board);
        
        sendToClient(playerId, roomInfo)
    }

    changeTurn(){
        // console.log("current turn: ", this.turn);
        
        this.turn = (this.turn + 1) % this.players.length;
        this.turnStartTime = Date.now();
        if(this.currentTurnTimout){
            clearTimeout(this.currentTurnTimout);
            this.startTurnTimer(15);
        }
    }

    checkJoinRoom(userId: string|null, players: number, cb: (num: number) => void){
        let code = 0;
        if(userId != null){
            code = -1; //người chơi đã có phòng
        }
        
        if(players === 2){
            code = -2; //đủ người
        }

        cb(code);
    }

    roomMoveMade(id: number, x: number, y: number){
        const playerIndex = this.getPlayerIndex(id);
        if(playerIndex == this.turn && this.players.length == 2){
            if(this.makeMove(x, y,  playerIndex)){
                this.sendMsgForPlayrsInRoom({type: "moveMade", x, y, player: playerIndex}, () => {})
                this.orderOfPlayer.push(1);

                if(checkWin(this.board, x, y, playerIndex)){
                    let playerDisconnect;
                    let startTime = Date.now();
                    this.players.forEach(player => {
                        if(player.isDisconnect){
                            playerDisconnect = player;
                            // room.removePlayer(player.id);
                        }
                    })
                    if(playerDisconnect){
                        this.gameDelay = true;
                    }
                    this.sendMsgForPlayrsInRoom({type: "gameOver", winner: this.players[playerIndex].username}, () => {});
                    
                    if(playerDisconnect){
                        console.log("bat dau dem thoi gian de roi phong");
                        this.checkOutRoomGameOverTimer(startTime, playerDisconnect);
                    }      
                }
                else{
                    this.changeTurn();
                    //sau 15s tự đánh nếu không có lượt đánh tiếp theo
                    const check = this.orderOfPlayer.length;               
                    const intervalId = setTimeout(() => {
                        if(getConnectionByUserId(this.players[this.turn]?.id) == null){
                            if(this.players[this.turn]){
                                this.players[this.turn].isDisconnect = true;
                            }
                        }                
                        if(check == this.orderOfPlayer.length){
                            // console.log("auto made move");                        
                            this.roomAutoMoveMade(this.players[this.turn].id);
                            this.autoPlayer(this.players[this.turn].id);
                        }
                        else{
                            clearTimeout(intervalId);
                        }
                    }, 15000);
                }
            }


        }
    }

    roomAutoMoveMade(id: number){
        const randomMove: {x: number, y: number} = randomMakeMove(this);
        const playerIndex = this.getPlayerIndex(id); 
        if(playerIndex == this.turn){
            if(this.makeMove(randomMove.x, randomMove.y, this.turn)){
                this.sendMsgForPlayrsInRoom({type: "autoMadeMove", x: randomMove.x, y: randomMove.y, player: playerIndex}, () => {});
                this.orderOfPlayer.push(1);

                if(checkWin(this.board, randomMove.x, randomMove.y, playerIndex)){
                    this.sendMsgForPlayrsInRoom({type: "gameOver", winner: this.players[playerIndex].username}, () => {});
                }
                else{
                    this.changeTurn();
                }
            }       
        }
    }

    //tự đánh ngẫu nhiên
    autoPlayer(id: number){
        const check = this.orderOfPlayer.length;
        if(this.gameDelay == false){
            const interval = setTimeout(() => {
                if(check === this.orderOfPlayer.length && this.players.length > 1){
                    this.roomAutoMoveMade(id);
                    // console.log("currnt turn", this.turn);
                    // console.log("currnt order of player", this.orderOfPlayer.length);             
                    if(this.players[this.turn]){
                        this.autoPlayer(this.players[this.turn].id);
                    }
                }
                else{
                    clearInterval(interval);
                }
            }, 15000);
        }
        
    }

    //gửi tin nhắn cho tất cả người chơi trong phòng
    sendMsgForPlayrsInRoom(msg, cb:() => void){
        this.players.forEach(player => {
            const playerConnection = getConnectionByUserId(player.id);
            if(playerConnection){
                if(msg != ""){
                    sendToClient(player.id, msg);
                }
                cb;
            }
        })
    }

    //xóa người chơi khỏi phòng khi mất kết nối
    checkOutRoomTimer(startTime: number, userId: number, rooms: Map<string, Room>, cb: () => void){
        this.gameDelay = true;
        const playerWaiting = this.players.find(player => player.id === userId);
        if(playerWaiting){
            playerWaiting.isDisconnect = true;
            playerWaiting.isWaitingForConnect = true;
            const interval = setInterval(() => {
                const currentTime = Date.now();
                const elapsedTime = currentTime - startTime;
                console.log("remove after: ", elapsedTime/1000);
                
                if(elapsedTime >= 30000){
                    console.log("het 30s, neu phong 1 ng, xoa khoi phong, xoa luon phong");
                    if(this.players.length == 1){
                        this.removePlayer(userId);
                        rooms.delete(this.name);                   
                    }else if(this.players.length == 2){
                        this.removePlayer(userId);
                        //GỬI THÔNG BÁO CHO NGƯỜI CHƠI TRONG PHÒNG
                    }
                    console.log(rooms);   
                    cb;
                    clearInterval(interval);
                }else if(getConnectionByUserId(userId)){
                    console.log("ket noi lai");
                    playerWaiting.isDisconnect = false;
                    playerWaiting.isWaitingForConnect = false;
                    this.gameDelay = false;
                    cb;
                    clearInterval(interval);
                } 
            }, 1000);
        }
        
    }

    checkOutRoomGameOverTimer(startTime: number, player: Player){

        const interval = setInterval(() => {
            const currentTime = Date.now();
            const elapsedTime = currentTime - startTime;
            console.log(elapsedTime/1000);

            if(elapsedTime >= 30000){

                if(getConnectionByUserId(player.id) == null){
                    console.log("Het 30s, ng choi chua ket noi lai, xoa nguoi choi khoi phong");
                    this.removePlayer(player.id);
                }
                clearInterval(interval);
            }else{
                if(getConnectionByUserId(player.id) !== null){
                    console.log("ng choi tro lai phong");
                    
                    this.resetBoad();
                    this.gameDelay = false;
                    clearInterval(interval);
                }
            }
        }, 2000);
    }

    //đếm ngược thời gian cho một turn, 
    startTurnTimer(time: number){
        this.currentTurnTimout = setTimeout(() => {
            this.changeTurn();
        }, (time * 1000));

    }

    playerDisconnect(userId: number){
        const playerDisconnect = this.players.find(player => player.id === userId);
        if(playerDisconnect){
            playerDisconnect.isDisconnect = true;
        }
    }
}
