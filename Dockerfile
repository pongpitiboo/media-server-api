FROM node:20-bullseye-slim

# ตั้งค่า Environment Variables สำหรับ Ports และ Hosts เป็นค่าเริ่มต้น
ENV API_PORT=3000
ENV RTMP_PORT=8080
ENV HTTP_PORT=8000
ENV HOST=0.0.0.0
ENV HOST_RTMP=127.0.0.1
ENV HOST_HTTP=127.0.0.1

# ติดตั้ง FFmpeg และ Bun (จำเป็นต้องติดตั้ง curl/unzip เพื่อติดตั้ง Bun)
# เนื่องจากใช้ Debian จึงใช้ apt-get ได้
RUN apt-get update && \
    apt-get install -y ffmpeg curl unzip && \
    rm -rf /var/lib/apt/lists/*

# ติดตั้ง Bun.js ด้วยตนเอง
# ใช้คำสั่งติดตั้ง Bun (โดยปกติจะติดตั้งที่ /root/.bun)
ENV BUN_INSTALL="/usr/local"
ENV PATH="$BUN_INSTALL/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash

# ตั้งค่า Working Directory ภายในคอนเทนเนอร์
WORKDIR /app

# คัดลอกไฟล์ package.json เพื่อติดตั้ง Dependencies และใช้ประโยชน์จาก Layer Cache
COPY package*.json ./

# ติดตั้ง Node Dependencies ด้วย Bun
# ใช้ --production เพื่อติดตั้งเฉพาะ Dependencies ที่จำเป็นในการรัน
RUN bun install --production

# คัดลอกไฟล์โค้ดที่เหลือทั้งหมด
# ไฟล์โค้ดหลักคือ app.js
COPY . .

# สร้างโฟลเดอร์สำหรับเก็บไฟล์มีเดีย
RUN mkdir -p media

# เปิด Port ที่จำเป็นสำหรับ API, RTMP, และ HTTP-FLV
EXPOSE ${API_PORT}
EXPOSE ${RTMP_PORT}
EXPOSE ${HTTP_PORT}

# คำสั่งเริ่มต้นเมื่อคอนเทนเนอร์รัน โดยใช้ Bun รันไฟล์ app.js
CMD ["bun", "app.js"]