import { PrismaClient } from "@prisma/client"
import { WebSocket, WebSocketServer } from "ws"
import bcrypt from "bcrypt"
import { v4 as uuidv4 } from "uuid"
import { Player } from "./player"
import { Room } from "./room"
import {
    checkWin,
    randomMakeMove,
    sendAllInfoRoom,
    sendRoomInfo,
    setOutRoomTimer,
    setRoomName,
} from "./utils"
import { authenticateUser, generateToken } from "./auth"
import * as url from "url"
import express from "express"
import * as http from "http"
import cors from "cors"
import { idText } from "typescript"
// config
const JWT_SECRET = "your_jwt_secret"
const prisma = new PrismaClient()
const boardSize = 15 // Example board size, can be configured
let inHomeScene: boolean = false
let intervalId: NodeJS.Timeout | null = null 

// API
const app = express()
const server = http.createServer(app)
app.use(cors())
app.use(express.json())

// dang ky
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body
    try {
        const hashedPassword = await bcrypt.hash(password, 10)
        const user = await prisma.user.create({
            data: { username, password: hashedPassword },
        })
        const token = await generateToken(user)
        res.json({
            type: "registerSuccess",
            message: `User registered successfully`,
            token,
            userName: username,
        })
    } catch (error) {
        console.error("Error during registration:", error)
        res.json({
            type: "registerError",
            message: "Registration failed",
        })
    }
})

// dang nhap
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body

    console.log("api login => username, password", username, password)

    if (!username || !password) {
        res.json(
            JSON.stringify({
                type: "loginError",
                message: "Invalid username or password",
            })
        )
        return
    }
    try {
        const user = await prisma.user.findUnique({ where: { username } })
        if (user && (await bcrypt.compare(password, user.password))) {
            const token = await generateToken(user)

            res.json({
                type: "loginSuccess",
                message: `Welcome, ${username}`,
                token,
                userName: username,
            })
        } else {
            res.json({
                type: "loginError",
                message: "Invalid username or password",
            })
        }
    } catch (error) {
        console.error("Error during login:", error)
        res.json({ type: "loginError", message: "Login failed" })
    }
})

// auto login
app.post("/api/loginByToken", async (req, res) => {
    const { token } = req.body

    try {
        const userData = await authenticateUser(token, JWT_SECRET, prisma)
        if (userData) {
            res.json({
                type: "loginSuccess",
                message: `Welcome back, ${userData.username}`,
                userName: userData.username,
            })
        } else {
            res.json({
                type: "loginError",
                message: "Invalid token",
            })
        }
    } catch (error) {
        console.error("Error during autoLogin:", error)
        res.json({
            type: "loginError",
            message: "Invalid token",
        })
    }
})

// SOCKET
export interface WebSocketUserData {
    id: number
    username: string
    roomId: string | null
    isAlive: boolean
}

const connections = new Map<WebSocket, WebSocketUserData>()
const rooms = new Map<string, Room>()
const neededIfRoom: {
    [id: string]: {
        id: string
        name: string
        bet: string
        started: boolean
        players: Player[]
    }
} = {}

const wss = new WebSocketServer({ server })

wss.on("connection", async (ws: WebSocket, req: Request) => {
    
    const query: any = url.parse(req.url, true).query

    const token: string = query.token

    // console.log("query", query, token)

    if (!token) {
        //   khong co token
        ws.send("No token => close")
        ws.close()
        return
    }

    try {
        const userData = await authenticateUser(token, JWT_SECRET, prisma)
        if (userData) {
            const playerConnection = [...connections.entries()].find(
                ([_, v]) => v.id === userData.id
            )?.[0]

            // neu co connection cu -> delete cai cu di
            if (playerConnection) {
                //   co connection cu
                console.log("delete old connection")
                connections.delete(playerConnection)
            }

            // set cai moi vao
            connections.set(ws, {
                id: userData.id,
                username: userData.username,
                roomId: null,
                isAlive: true,
            })

            // log ra list connnectioin hien tai
            console.log("LIST CONNECTION")
            for (const [key, value] of connections.entries()) {
                console.log(`Key: ${key}, Value: ${JSON.stringify(value)}`)
            }

            ws.send(
                JSON.stringify({
                    type: "connected",
                    message: `Welcome back, ${userData.username}`,
                    userName: userData.username,
                })
            )

            /* check xem no dang o trong room nao khong, thi goi vao room + update lai connection*/
            rooms.forEach((value: any, key) => {
                const playersInRoom: Player[] = value?.players
                let check = false
                const result = playersInRoom?.filter((item) => {
                    return item.id === userData.id
                })

                if (result?.length > 0) {
                    check = true
                }

                const roomId: string = value.name;
                if (check) {
                    console.log("dang o trong room")
                    //      co player in room
                    const connectionPlayer = connections.get(ws)
                    //@ts-ignore
                    connectionPlayer.roomId = roomId

                    //      goi player vao room
                    value.reconnectPlayer(userData?.id)
                }
            })
        } else {
            ws.send(
                JSON.stringify({
                    type: "connectError",
                    message: "Invalid token",
                })
            )
            ws.close()
        }
    } catch (error) {
        console.error("Error during autoLogin:", error)
        ws.send(
            JSON.stringify({
                type: "connectError",
                message: JSON.stringify(error),
            })
        )
    }

    ws.on('pong', () => {        
        const playerConnecTion = connections.get(ws);
        if(playerConnecTion){
            playerConnecTion.isAlive = true;
            connections.set(ws, playerConnecTion);
            console.log("pong", playerConnecTion);           
        }

    })

    const checkConnectionAlive = setInterval(() => {
        // console.log(connections.size);
        
        connections.forEach((userData, ws) => {
            // console.log(userData);
            
            if(!userData.isAlive){
                console.log(`nguoi choi ${userData.id} da mat ket noi, doi 30s neu vao lai phong`);
                //nếu người chơi ở trong phòng có 1 người, sau 30s xóa ng chơi khỏi phòng
                if(userData.roomId !== null){
                    const room = rooms.get(userData.roomId);
                    const player = room?.players.find(p => p.id === userData.id);
                    if(room && room.players.length < 2){
                        const startTime = Date.now();
                        room.checkOutRoomTimer(startTime, userData.id, rooms, () =>{
                            sendAllInfoRoom(ws, rooms);
                        });
                    }
                    if(room && room.players.length == 2){
                        //sử lý tính thời gian mất kết nối
                        room.playerDisconnect(userData.id);
                    }
                }
                // ws.terminate();
                connections.delete(ws);
                clearInterval(checkConnectionAlive);
                return;
            }
            userData.isAlive = false;
            ws.ping();
        })
    }, 5000);

    ws.on("message", async (message: string) => {
        const data = JSON.parse(message)
        const type = data.type

        if (type === "") {
        } else {
            const userData = connections.get(ws)
            if (!userData) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Not authenticated",
                    })
                )
                return
            }

            if (type === "createRoom") {
                const { roomBet } = data
                const roomId = uuidv4()
                const roomName = setRoomName(rooms)
                const room = new Room(roomId, roomName, boardSize, roomBet) //them cuoc
                const player = new Player(userData.id, userData.username)
                room.addPlayer(player)
                rooms.set(roomName, room)
                userData.roomId = roomName
                sendRoomInfo(ws, room)
                ws.send(
                    JSON.stringify({
                        type: "createRoomSuccess",
                        roomId,
                        roomName: roomName,
                        roomBet: roomBet,
                    })
                )

                //test show room
                sendAllInfoRoom(ws, rooms)
            } else if (type === "joinRoom") {
                const { roomName } = data
                const room = rooms.get(roomName)
                let canJoin = false;
                if(room){
                    const checkJoinRoom = room?.checkJoinRoom(userData.roomId, room.players.length, (code) => {
                        switch (code) {
                            case -1:
                                ws.send(JSON.stringify({ type: 'joinRoomError', codeErr: -1 }));
                                break;
                            case -2:
                                ws.send(JSON.stringify({ type: "joinRoomError", codeErr: -2 }));
                                break;
                            default:
                                break;
                        }
                        if(code === 0){
                            canJoin = true;
                        }
                    })

                    if(canJoin){
                        const player = new Player(userData.id, userData.username)
                        room.addPlayer(player)
                        userData.roomId = roomName
                        sendRoomInfo(ws, room)
                        ws.send(
                            JSON.stringify({
                                type: "joinRoomSuccess",
                                roomId: room.id,
                                roomName,
                                roomBet: room.bet,
                            })
                        )
                    }
                    else{
                        return;
                    }
                }else{
                    ws.send(JSON.stringify({ type: "joinRoomError", codeErr: -3 }));
                }
            } else if (type === "setReady") {
                if (userData.roomId) {
                    const room = rooms.get(userData.roomId)
                    if (room) {
                        room.setPlayerReady(userData.id)
                        room.players.forEach((p) => {
                            const playerConnection = getConnectionByUserId(p.id);
                            if (playerConnection) {
                                sendRoomInfo(playerConnection, room)
                            }
                        })
                        if (room.canStartGame()) {
                            room.startGame()
                            room.sendMsgForPlayrsInRoom({ type: "gameStart" }, () => {});
                        }
                    }
                }
            } else if (type === "makeMove") {
                const { x, y } = data
                if(userData.roomId){
                    const room = rooms.get(userData.roomId);
                    if(room && room.gameStarted){
                        room.roomMoveMade(userData.id, x, y);
                    }
                }
            } else if (type === "newGame") {
                const { roomName } = data
                const room = rooms.get(roomName)
                if (room) {
                    // room.resetBoad()
                    if( room.gameDelay == false){
                        if (room.players.length === 2) {
                            room.sendMsgForPlayrsInRoom({type: "gameStarting",message: "Game will start in 5 seconds",}, () => {});
                            setTimeout(() => {
                                if (room.canStartGame()) {
                                    room.startGame();
                                    room.sendMsgForPlayrsInRoom({type: "gameStart",}, () => {});
                                    console.log("NEW GAME");
                                    
                                    room.autoPlayer(room.players[room.turn].id);
                                }
                            }, 5000)
                        }
                    }
                }
            } else if (type == "backHome") {
                const userData = data
                if (userData && userData.roomId) {
                    const room = rooms.get(userData.roomId)
                    if (room) {
                        //console.log(room?.name);
                        room.removePlayer(userData.playerId)
                        room.sendMsgForPlayrsInRoom({ type: "playerLeft", id: userData.playerId, username: userData.playerName, gameDelay: room.gameDelay}, () => {
                            sendAllInfoRoom(ws, rooms);
                        })
                        room.resetBoad()
                        if (room.players.length == 0) {
                            rooms.delete(userData.roomId)
                            userData.roomId = null
                            sendAllInfoRoom(ws, rooms)
                        }
                    }
                }
                const playerConecTion = connections.get(ws);
                if(playerConecTion){
                    playerConecTion.roomId = null;
                }
                // console.log("room id after: ", userData);
            } else if (type == "loadHomeScene") {
                sendAllInfoRoom(ws, rooms)
                inHomeScene = true
            } else if (type == "loadRoomScene") {
                inHomeScene = false
                const { roomName } = data
                const room = rooms.get(roomName)
                const checkPlayerReconnect = room?.players.find(player => player.id !== userData.id)?.isWaitingForConnect
                console.log("check: ", checkPlayerReconnect);
                console.log("check: ", room?.players.find(player => player.id !== userData.id)?.username);
                
                if (room && checkPlayerReconnect===false) {                    
                    // room.sendMsgForPlayrsInRoom({type: "playerJoined", id: userData.id, username: userData.username}, () => {});
                    room.players.forEach((player) => {
                        const playerConnection = getConnectionByUserId(player.id)
                        if (playerConnection) {
                            sendRoomInfo(playerConnection, room)
                            playerConnection.send(
                                JSON.stringify({type: "playerJoined",id: userData.id,username: userData.username,}),
                            )
                        }
                    })
                    if (room.players.length === 2) {
                        room.setPlayerReady(userData.id);
                        room.sendMsgForPlayrsInRoom({type: "gameStarting",message: "Game will start in 5 seconds",second: 5,}, () => {});
                        setTimeout(() => {
                            // console.log("readly: ", room.canStartGame);
                            if (room.canStartGame() && room.gameDelay == false) {
                                // console.log("START GAME");
                                room.startGame();
                                room.sendMsgForPlayrsInRoom({type: "gameStart",message: "first",}, () => {});
                                console.log("JOIN ROOM");
                                
                                room.autoPlayer(room.players[room.turn].id);
                            }
                        }, 5000)
                    }
                }else if(room && checkPlayerReconnect === true){
                    // hiện thị thông tin người chơi đang bận
                    sendToClient(userData.id, {type: "roomDelay"});    
                }
            }
        }

        if (inHomeScene == true) {
            intervalId = setInterval(() => {
                sendAllInfoRoom(ws, rooms)
            }, 5000)
        } else {
            if (intervalId) {
                clearInterval(intervalId)
                intervalId = null
            }
        }
    })

    if (inHomeScene == true) {
        intervalId = setInterval(() => {
            sendAllInfoRoom(ws, rooms)
        }, 5000)
    } else {
        if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
        }
    }

    ws.on("close", () => {
        const userData = connections.get(ws)
        console.log("CLOSED => ", userData)
        // const interval = setTimeout(() => {
        //     if(userData){
        //         if(userData.roomId == null){
        //             connections.delete(ws);
        //         }
        //     }
        // }, 30000);
        
        // clearInterval(checkConnectionAlive);
        // connections.delete(ws);
    })
})

//  gui message den player theo Id
export function sendToClient(playerId, objMessage) {
    if (!playerId) return false
    const playerConnection = [...connections.entries()].find(
        ([_, v]) => v.id === playerId
    )?.[0]
    if (playerConnection) {
        playerConnection.send(JSON.stringify(objMessage))
    } else {
        return false
    }
}

//  gui message den player theo Id
export function sendToClients(array) {
    //  array   playerId, objMessage
}

export function getConnectionByUserId(playerId) {
    if (!playerId) return null
    const playerConnection = [...connections.entries()].find(
        ([_, v]) => v.id === playerId
    )?.[0]
    return playerConnection
}

const PORT = 9001
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
