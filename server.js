const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingPlayer = null;
let roomCounter = 0;
const rooms = {};

// DỮ LIỆU BOSS THẾ GIỚI
let worldBoss = { hp: 100000, maxHp: 100000, x: 400, isDead: false };
const coopPlayers = {}; 
let coopLobby = {}; // Chứa người đang ở phòng chờ Boss

io.on('connection', (socket) => {
    // === 1v1 MATCHMAKING ===
    socket.on('findMatch', (playerName) => {
        socket.playerName = playerName;
        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            const mapIndex = Math.floor(Math.random() * 5); 

            socket.join(roomId); waitingPlayer.join(roomId);
            rooms[roomId] = { p1: waitingPlayer, p2: socket };
            
            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId, oppName: socket.playerName, mapId: mapIndex });
            socket.emit('matchFound', { role: 'p2', roomId: roomId, oppName: waitingPlayer.playerName, mapId: mapIndex });
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting_1v1'); // Mở màn hình chờ
        }
    });

    socket.on('cancelMatch', () => { if(waitingPlayer === socket) waitingPlayer = null; });

    socket.on('playerAction', (data) => socket.to(data.roomId).emit('updateOpponent', data.playerData));
    socket.on('playerHit', (data) => socket.to(data.roomId).emit('takeDamage', data.damage));
    socket.on('shoot', (data) => socket.to(data.roomId).emit('opponentShoot', data));
    socket.on('applyStun', (data) => socket.to(data.roomId).emit('takeStun', data.duration));

    // === CO-OP WORLD BOSS LOBBY ===
    socket.on('joinWorldBossLobby', (playerData) => {
        socket.join('wb_lobby');
        coopLobby[socket.id] = playerData;
        io.to('wb_lobby').emit('lobbyUpdate', Object.keys(coopLobby).length); // Báo số người
        
        if(Object.keys(coopLobby).length >= 4) startWorldBoss(); // Đủ 4 tự động vào
    });
    
    socket.on('leaveWorldBossLobby', () => {
        socket.leave('wb_lobby'); delete coopLobby[socket.id];
        io.to('wb_lobby').emit('lobbyUpdate', Object.keys(coopLobby).length);
    });

    socket.on('startWorldBossEarly', () => startWorldBoss()); // Ép vào luôn khi chưa đủ

    function startWorldBoss() {
        const playersInLobby = Object.keys(coopLobby);
        if(playersInLobby.length === 0) return;
        
        for(let id of playersInLobby) {
            const s = io.sockets.sockets.get(id);
            if(s) { s.leave('wb_lobby'); s.join('world_boss_room'); coopPlayers[id] = coopLobby[id]; }
        }
        coopLobby = {}; 
        io.to('world_boss_room').emit('worldBossInit', { boss: worldBoss, teammates: coopPlayers });
    }

    socket.on('coopPlayerAction', (data) => {
        if(coopPlayers[socket.id]) {
            coopPlayers[socket.id] = data; socket.to('world_boss_room').emit('updateTeammate', { id: socket.id, data: data });
        }
    });

    socket.on('coopShoot', (data) => socket.to('world_boss_room').emit('teammateShoot', data));
    socket.on('coopStunBoss', (dur) => socket.to('world_boss_room').emit('bossStunned', dur));
    
    socket.on('hitWorldBoss', (damage) => {
        if (worldBoss.isDead) return;
        worldBoss.hp -= damage;
        io.to('world_boss_room').emit('worldBossHpUpdate', worldBoss.hp);

        if (worldBoss.hp <= 0) {
            worldBoss.isDead = true; io.to('world_boss_room').emit('worldBossDefeated');
            setTimeout(() => { worldBoss.hp = worldBoss.maxHp; worldBoss.isDead = false; }, 30000);
        }
    });

    socket.on('disconnect', () => { 
        if (waitingPlayer === socket) waitingPlayer = null; 
        if (coopLobby[socket.id]) { delete coopLobby[socket.id]; io.to('wb_lobby').emit('lobbyUpdate', Object.keys(coopLobby).length); }
        if (coopPlayers[socket.id]) { delete coopPlayers[socket.id]; io.to('world_boss_room').emit('teammateLeft', socket.id); }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Game đang chạy tại port ${PORT}`));
