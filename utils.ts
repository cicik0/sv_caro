import { Player } from 'player';
import { Room } from './room';
import { WebSocket } from 'ws';
import { WebSocketUserData } from 'server';
import { start } from 'repl';

export function checkWin(board: number[][], x: number, y: number, player: number): boolean {
    const boardSize = board.length;
    const directions: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of directions) {
        let count = 1;
        for (let step = 1; step < 5; ++step) {
            let newX = x + step * dx;
            let newY = y + step * dy;
            if (newX >= 0 && newX < boardSize && newY >= 0 && newY < boardSize && board[newX][newY] === player) {
                count++;
            } else {
                break;
            }
        }
        for (let step = 1; step < 5; ++step) {
            let newX = x - step * dx;
            let newY = y - step * dy;
            if (newX >= 0 && newX < boardSize && newY >= 0 && newY < boardSize && board[newX][newY] === player) {
                count++;
            } else {
                break;
            }
        }
        if (count >= 5) {
            return true;
        }
    }
    return false;
}

export function sendRoomInfo(ws: WebSocket, room: Room): void {
    ws.send(JSON.stringify({
        type: 'roomInfo',
        roomId: room.id,
        roomName: room.name,
        roomBet: room.bet,
        players: room.players.map(p => ({ id: p.id, username: p.username })),
        board: room.board,
        gameStarted: room.gameStarted
    }));
}

//gửi thông tin tất cả các phòng
export function sendAllInfoRoom(ws: WebSocket, rooms: Map<String, Room>){
    // console.log("fuck");
    const selectRooms: { name: string, bet: string, gameStarted: boolean, players: Player[]}[] = [];
    rooms.forEach((room) => {
        const { name, bet, gameStarted, players } = room;
        selectRooms.push({ name, bet,  gameStarted, players });
    })
    // const arrayRooms = Array.from(rooms);
    
    ws.send(JSON.stringify({ type: 'showRoom', allroom:  selectRooms}));
}

//tạo tên room mới
export function setRoomName(rooms: Map<String, Room>): string{
    const keys = Array.from(rooms.keys()).map(Number); //lấy danh sách map, chuyển tên room thành kiểu số
    
    //sắp xếp các khóa 
    keys.sort((a, b) => a - b);

    //tìm vị trí trống, hoặc số tiếp theo;
    let newKey: number | null = null;
    for(let i = 0; i<keys.length; i++){
        if(keys[i] !== i + 1){
            newKey = i+1;
            break;
        }
    }

    if(newKey == null){
        newKey = keys.length + 1;
    }

    return newKey.toString();
}

//tạo một nước đi ngẫu nhiên cho người chơi khi người chơi hết thời gian đợi trong lượt chơi của mình
export function randomMakeMove(room: Room){
    const boardSizeClient = 15;
    let boardToRandom: {x: number, y: number}[] = [];
    let addCheckCell: {x: number, y: number}
    for(let i = 0; i<boardSizeClient; i++){
        for(let j = 0; j<boardSizeClient; j++){
            if(room.board[i][j] === -1){
                addCheckCell = {x: i, y: j};
                boardToRandom.push(addCheckCell);
            }
        }
    }

    let randomIndex = Math.floor(Math.random() * boardToRandom.length);
    let randomMove = boardToRandom[randomIndex];
    return randomMove;
}

export function elapsedTime(startTime: number, currentTime: number){
    if(currentTime - startTime >= 30000){
        return true;
    }
    return false;
}

export function setOutRoomTimer(startTime: number, cb: () => void){
    const interval = setInterval(() => {
        const currentTime = Date.now();
        const elapsedTime = currentTime - startTime;
        console.log(elapsedTime/1000);
        
        if(elapsedTime >= 30000){
            cb();
            clearInterval(interval);
        }
    }, 2000);
}