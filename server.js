const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingPlayer = null;
let roomCounter = 0;
const rooms = {};

// DỮ LIỆU BOSS THẾ GIỚI (Chạy liên tục trên Server)
let worldBoss = {
    hp: 50000,
    maxHp: 50000,
    x: 400,
    isDead: false
};
const coopPlayers = {}; // Lưu trữ những ai đang ở trong phòng Boss Thế Giới

io.on('connection', (socket) => {
    // === 1v1 MATCHMAKING ===
    socket.on('findMatch', (playerName) => {
        socket.playerName = playerName;
        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            
            // Random Map (0 đến 4) cho 2 người
            const mapIndex = Math.floor(Math.random() * 5); 

            socket.join(roomId); waitingPlayer.join(roomId);
            rooms[roomId] = { p1: waitingPlayer, p2: socket, rematchVotes: 0 };
            
            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId, oppName: socket.playerName, mapId: mapIndex });
            socket.emit('matchFound', { role: 'p2', roomId: roomId, oppName: waitingPlayer.playerName, mapId: mapIndex });
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Đang tìm đối thủ...');
        }
    });

    socket.on('playerAction', (data) => socket.to(data.roomId).emit('updateOpponent', data.playerData));
    socket.on('playerHit', (data) => socket.to(data.roomId).emit('takeDamage', data.damage));
    socket.on('shoot', (data) => socket.to(data.roomId).emit('opponentShoot', data));

    // === CHẾ ĐỘ CO-OP (BOSS THẾ GIỚI) ===
    socket.on('joinWorldBoss', (playerData) => {
        socket.join('world_boss_room');
        coopPlayers[socket.id] = playerData;
        
        // Gửi thông tin Boss và danh sách đồng đội cho người mới
        socket.emit('worldBossInit', { boss: worldBoss, teammates: coopPlayers });
        // Báo cho những người cũ có người mới vào
        socket.to('world_boss_room').emit('teammateJoined', { id: socket.id, data: playerData });
    });

    socket.on('coopPlayerAction', (data) => {
        if(coopPlayers[socket.id]) {
            coopPlayers[socket.id] = data;
            socket.to('world_boss_room').emit('updateTeammate', { id: socket.id, data: data });
        }
    });

    socket.on('coopShoot', (data) => {
        socket.to('world_boss_room').emit('teammateShoot', data);
    });

    socket.on('hitWorldBoss', (damage) => {
        if (worldBoss.isDead) return;
        worldBoss.hp -= damage;
        
        // Broadcast HP mới cho tất cả
        io.to('world_boss_room').emit('worldBossHpUpdate', worldBoss.hp);

        if (worldBoss.hp <= 0) {
            worldBoss.isDead = true;
            io.to('world_boss_room').emit('worldBossDefeated');
            
            // Hồi sinh Boss sau 30 giây
            setTimeout(() => {
                worldBoss.hp = worldBoss.maxHp;
                worldBoss.isDead = false;
                io.to('world_boss_room').emit('worldBossRespawn');
            }, 30000);
        }
    });

    socket.on('disconnect', () => { 
        if (waitingPlayer === socket) waitingPlayer = null; 
        if (coopPlayers[socket.id]) {
            delete coopPlayers[socket.id];
            io.to('world_boss_room').emit('teammateLeft', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Game đang chạy tại port ${PORT}`));
