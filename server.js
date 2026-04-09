// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // Cấp quyền truy cập file HTML

let waitingPlayer = null; // Người đang chờ ghép trận
let roomCounter = 0;

io.on('connection', (socket) => {
    console.log('Một người dùng vừa kết nối:', socket.id);

    // XỬ LÝ GHÉP TRẬN (MATCHMAKING)
    socket.on('findMatch', () => {
        if (waitingPlayer && waitingPlayer !== socket) {
            // Có người đang chờ -> Ghép trận
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            
            socket.join(roomId);
            waitingPlayer.join(roomId);

            // Gửi tín hiệu bắt đầu game. Phân loại ai là P1, ai là P2
            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId });
            socket.emit('matchFound', { role: 'p2', roomId: roomId });

            console.log(`Đã ghép trận: ${waitingPlayer.id} (P1) vs ${socket.id} (P2) vào ${roomId}`);
            waitingPlayer = null; // Xóa hàng đợi
        } else {
            // Chưa có ai -> Đưa vào hàng đợi chờ
            waitingPlayer = socket;
            socket.emit('waiting', 'Đang tìm đối thủ...');
        }
    });

    // NHẬN VÀ TRUYỀN DỮ LIỆU ĐỒNG BỘ CHUYỂN ĐỘNG (DI CHUYỂN, NHẢY, LƯỚT)
    socket.on('playerAction', (data) => {
        // Broadcast (phát sóng) hành động của người này cho người kia trong cùng phòng
        socket.to(data.roomId).emit('updateOpponent', data.playerData);
    });

    // KHI NGƯỜI CHƠI THOÁT
    socket.on('disconnect', () => {
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }
        console.log('Người dùng đã thoát:', socket.id);
        // Báo cho người cùng phòng biết đối thủ đã thoát
        // (Bạn có thể tự code thêm tính năng xử lý thắng/thua khi đối thủ out game)
    });
});

const PORT = process.env.PORT || 3000; // Tự động lấy Port của Server mạng, nếu không có thì dùng 3000
http.listen(PORT, () => {
    console.log(`Server Game đang chạy tại port ${PORT}`);
});