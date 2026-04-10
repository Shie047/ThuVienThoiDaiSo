const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingPlayer = null;
let roomCounter = 0;
const pvpRooms = {};

const coopLobbies = {}; 
const coopGames = {};   

io.on('connection', (socket) => {
    // === 1v1 MATCHMAKING (BO3) ===
    socket.on('findMatch', (playerName) => {
        socket.playerName = playerName;
        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++; const roomId = 'pvp_' + roomCounter;
            const mapIndex = Math.floor(Math.random() * 5); 

            socket.join(roomId); waitingPlayer.join(roomId);
            pvpRooms[roomId] = { p1: waitingPlayer, p2: socket, score: {p1: 0, p2: 0}, mapId: mapIndex, readyVotes: 0, rematchVotes: 0, roundOver: false };
            
            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId, oppName: socket.playerName, mapId: mapIndex });
            socket.emit('matchFound', { role: 'p2', roomId: roomId, oppName: waitingPlayer.playerName, mapId: mapIndex });
            waitingPlayer = null;
        } else {
            waitingPlayer = socket; socket.emit('waiting_screen', 'ĐANG TÌM ĐỐI THỦ 1VS1...');
        }
    });

    socket.on('playerDied', (data) => {
        const room = pvpRooms[data.roomId];
        if (room && !room.roundOver) {
            room.roundOver = true; 
            const winnerRole = data.loserRole === 'p1' ? 'p2' : 'p1';
            room.score[winnerRole]++;
            
            if (room.score.p1 >= 2 || room.score.p2 >= 2) {
                io.to(data.roomId).emit('matchEnd', { winner: winnerRole, score: room.score });
            } else {
                io.to(data.roomId).emit('roundEnd', { winner: winnerRole, score: room.score });
            }
        }
    });

    socket.on('nextRoundReady', (roomId) => {
        const room = pvpRooms[roomId];
        if(room) {
            room.readyVotes++;
            if(room.readyVotes >= 2) {
                room.readyVotes = 0; room.roundOver = false;
                io.to(roomId).emit('startNextRound');
            }
        }
    });

    socket.on('rematchRequest', (roomId) => {
        const room = pvpRooms[roomId];
        if(room) {
            room.rematchVotes++;
            socket.to(roomId).emit('rematchOffer');
            if(room.rematchVotes >= 2) {
                room.rematchVotes = 0; room.score = {p1: 0, p2: 0}; room.roundOver = false;
                io.to(roomId).emit('rematchStart');
            }
        }
    });

    socket.on('playerAction', (data) => socket.to(data.roomId).emit('updateOpponent', data.playerData));
    socket.on('playerHit', (data) => socket.to(data.roomId).emit('takeDamage', data));
    socket.on('shoot', (data) => socket.to(data.roomId).emit('opponentShoot', data));
    socket.on('applyStun', (data) => socket.to(data.roomId).emit('takeStun', data.duration));
    socket.on('healTeammate', (data) => socket.to(data.roomId).emit('receiveHeal', data.amount));

    // === CO-OP MULTIPLAYER ===
    socket.on('joinCoopLobby', (data) => { 
        const roomType = data.type;
        const maxPlayers = roomType === 'world' ? 8 : 4;
        const lobbyId = 'lobby_' + roomType;

        if (!coopLobbies[lobbyId]) coopLobbies[lobbyId] = { players: {}, max: maxPlayers, type: roomType, hostId: socket.id, timer: null };
        const lobby = coopLobbies[lobbyId];
        
        if (Object.keys(lobby.players).length >= maxPlayers && lobby.timer) return socket.emit('waiting_screen', 'PHÒNG ĐÃ ĐẦY VÀ ĐANG VÀO TRẬN!');

        socket.join(lobbyId); lobby.players[socket.id] = data;
        socket.emit('lobbyJoined', { isHost: lobby.hostId === socket.id });
        io.to(lobbyId).emit('lobbyUpdate', { count: Object.keys(lobby.players).length, max: maxPlayers });
        
        if (Object.keys(lobby.players).length >= maxPlayers && !lobby.timer) {
            let timeLeft = 15;
            io.to(lobbyId).emit('lobbyCountdown', timeLeft);
            lobby.timer = setInterval(() => {
                timeLeft--;
                if(timeLeft <= 0) { clearInterval(lobby.timer); startCoopGame(lobbyId); } 
                else io.to(lobbyId).emit('lobbyCountdown', timeLeft);
            }, 1000);
        }
    });
    
    socket.on('urgeHost', (roomType) => {
        const lobbyId = 'lobby_' + roomType;
        const lobby = coopLobbies[lobbyId];
        if (lobby && lobby.hostId) io.to(lobby.hostId).emit('hostUrged');
    });

    socket.on('startCoopEarly', (roomType) => {
        const lobbyId = 'lobby_' + roomType;
        if(coopLobbies[lobbyId] && coopLobbies[lobbyId].hostId === socket.id) {
            if(coopLobbies[lobbyId].timer) clearInterval(coopLobbies[lobbyId].timer);
            startCoopGame(lobbyId);
        }
    });

    function startCoopGame(lobbyId) {
        const lobby = coopLobbies[lobbyId];
        if (!lobby || Object.keys(lobby.players).length === 0) return;
        
        const gameId = 'game_' + lobbyId + '_' + Date.now();
        coopGames[gameId] = { players: lobby.players, bossHp: lobby.type === 'world' ? 150000 : 30000 };

        let isHost = true; 
        for(let id in lobby.players) {
            const s = io.sockets.sockets.get(id);
            if(s) { 
                s.leave(lobbyId); s.join(gameId); s.coopGameId = gameId; 
                io.to(id).emit('coopGameInit', { roomId: gameId, type: lobby.type, teammates: lobby.players, bossHp: coopGames[gameId].bossHp, isHost: isHost });
                isHost = false; 
            }
        }
        delete coopLobbies[lobbyId]; 
    }

    socket.on('coopPlayerAction', (data) => {
        if(socket.coopGameId && coopGames[socket.coopGameId]) {
            coopGames[socket.coopGameId].players[socket.id] = data;
            socket.to(socket.coopGameId).emit('updateTeammate', { id: socket.id, data: data });
        }
    });

    socket.on('coopShoot', (data) => { if(socket.coopGameId) socket.to(socket.coopGameId).emit('teammateShoot', data); });
    socket.on('coopStunBoss', (dur) => { if(socket.coopGameId) socket.to(socket.coopGameId).emit('bossStunned', dur); });
    socket.on('bossAction', (data) => { if(socket.coopGameId) socket.to(socket.coopGameId).emit('updateBoss', data); });
    socket.on('bossShoot', (data) => { if(socket.coopGameId) socket.to(socket.coopGameId).emit('bossFires', data); });

    socket.on('hitCoopBoss', (damage) => {
        if(!socket.coopGameId || !coopGames[socket.coopGameId]) return;
        let game = coopGames[socket.coopGameId];
        game.bossHp -= damage;
        io.to(socket.coopGameId).emit('coopBossHpUpdate', game.bossHp);
        if (game.bossHp <= 0) { io.to(socket.coopGameId).emit('coopBossDefeated'); delete coopGames[socket.coopGameId]; }
    });

    function handleLobbyLeave(socketId) {
        for(let l in coopLobbies) {
            let lobby = coopLobbies[l];
            if(lobby.players[socketId]) {
                delete lobby.players[socketId]; 
                let ioSocket = io.sockets.sockets.get(socketId);
                if(ioSocket) ioSocket.leave(l);
                if (lobby.hostId === socketId) {
                    let keys = Object.keys(lobby.players);
                    if (keys.length > 0) { lobby.hostId = keys[0]; io.to(lobby.hostId).emit('lobbyJoined', { isHost: true }); }
                }
                if (lobby.timer && Object.keys(lobby.players).length < lobby.max) {
                    clearInterval(lobby.timer); lobby.timer = null;
                }
                io.to(l).emit('lobbyUpdate', { count: Object.keys(lobby.players).length, max: lobby.max });
            }
        }
    }

    socket.on('cancelMatch', () => { if(waitingPlayer === socket) waitingPlayer = null; handleLobbyLeave(socket.id); });
    socket.on('disconnect', () => { 
        if (waitingPlayer === socket) waitingPlayer = null; 
        handleLobbyLeave(socket.id);
        if (socket.coopGameId && coopGames[socket.coopGameId]) io.to(socket.coopGameId).emit('teammateLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Game đang chạy tại port ${PORT}`));
