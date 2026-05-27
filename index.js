import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import connectDB from './config/dbConfig.js'
import patient from './routes/patient.js'
import doctor from './routes/doctor.js'
import appointment from './routes/appointment.js'
import lab from './routes/laboratory.js'
import pharmacy from './routes/pharmacy.js'
import path from 'path';
import { fileURLToPath } from 'url';
// import authRoutes from './routes/Hospital/auth.js';
// import hospitalRoutes from './routes/Hospital/hospital.js';
// import adminRoutes from './routes/Hospital/admin.js';
// import departmentRoutes from "./routes/Hospital/department.routes.js";
// import fileRoutes from './routes/Hospital/fileRoute.js'
// import locations from './routes/Hospital/location.js'
// import hospitalStaff from './routes/Hospital/hospitalStaff.js'
// import hospitalDoctor from './routes/Hospital/hospitalDoctor.js'
// import hospitalPatient from './routes/Hospital/hospitalPatient.js'
// import bed from './routes/Hospital/bed.js'
// import hospitalPrescription from './routes/Hospital/prescription.js'

import authRoutes from "./routes/Hospital/auth.js";
import hospitalRoutes from "./routes/Hospital/hospital.js";
import adminRoutes from "./routes/Hospital/admin.js";
import messageRoutes from "./routes/Hospital/chat.routes.js";
import './seed/seedLocation.js'
import http from 'http'
// import https from "https";
import fs from "fs";
import { Server } from 'socket.io'
import Message from './models/Hospital/Message.js'
import User from './models/Hospital/User.js'
import CallLog from './models/Hospital/CallLog.js'
import './utils/cronFunction.js'

import Conversation from './models/Hospital/Conversation.js'
import jwt from 'jsonwebtoken';
import admin from './routes/admin.js'
import adminauth from './routes/Admin/auth.routes.js'
import faqRoutes from "./routes/Admin/faq.routes.js";
import adminProfileRoutes from "./routes/Admin/profile.routes.js";
import adminpatients from "./routes/Admin/patient.routes.js";
import notificationRoutes from "./routes/Admin/notification.routes.js";
import CmsPageRoutes from "./routes/Admin/cms.routes.js";
import AdminDoctorRoutes from "./routes/Admin/doctor.routes.js";
import AdminLabRoutes from "./routes/Admin/lab.routes.js";
import AdminStaffRoutes from "./routes/Admin/staff.routes.js";
import AdminPharmacyRoutes from "./routes/Admin/pharmacy.routes.js";
import { sendPush } from "./utils/sendPush.js";



import AdminhospitalRoutes from "./routes/Admin/hospital.routes.js";
import AdminsocialRoutes from "./routes/Admin/social.routes.js";

import LandingPage from "./routes/Admin/landing.routes.js";
import locationRoutesAdmin from "./routes/Admin/location.routes.js";
import editRequestRoutes from "./routes/Admin/editRequest.routes.js";
import supplierRoutes from "./routes/Admin/supplier.routes.js";
import PatientKyc from './models/Patient/kyc.model.js'
import PatientDemographic from './models/Patient/demographic.model.js'
import MedicalHistory from './models/Patient/medicalHistory.model.js'
import rateLimit from 'express-rate-limit'
import optimizeApi from './routes/optimize.js'
import { sendWelcomeEmail } from './utils/globalFunction.js'
import staff from './routes/staff.js'
import department from './routes/departmentRoutes.js'
import certificate from './routes/certificate.js'
import './utils/sendTemplateEmail.js'
import DoctorAbout from './models/Doctor/addressAbout.model.js'
import MedicalLicense from './models/Doctor/medicalLicense.model.js'
import DoctorEduWork from './models/Doctor/eduWork.js'
import DoctorKyc from './models/Doctor/kyc.model.js'
import DoctorClinic from './models/Doctor/Clinic.model.js'
dotenv.config()
const app = express()
app.use(cors())
connectDB()
app.use(express.json())

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use((err, req, res, next) => {
    console.error(err.stack);

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error"
    });
})
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100, // ek IP se max 100 requests
    message: "Too many requests from this IP, please try again later"
});

// 👇 IMPORTANT: yaha lagao
// app.use(limiter);
const server = http.createServer(app);


// const server = https.createServer(
//   {
//     key: fs.readFileSync("/www/wwwroot/api.neohealthcard.com/ssl/privkey.pem"),
//     cert: fs.readFileSync("/www/wwwroot/api.neohealthcard.com/ssl/fullchain.pem"),
//   },
//   app
// );


// 🔹 SOCKET.IO INIT
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// 🔐 SOCKET JWT AUTH MIDDLEWARE
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error("Unauthorized"));

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("decoded", decoded)
        socket.userId = decoded.id || decoded.user;

        console.log("🔐 Socket Auth:", decoded.user);
        next();
    } catch (err) {
        return next(new Error("Invalid token"));
    }
});


// ================= SOCKET LOGIC =================
const onlineUsers = new Map(); // userId -> socketId
const activeCalls = new Set(); // userIds
const groupCallParticipants = new Map();
io.on("connection", (socket) => {
    console.log("🔌 Socket connected:", socket.id);
    onlineUsers.set(socket.userId, socket.id);

    io.emit("online-users", Array.from(onlineUsers.keys()));

    socket.on("join-conversation", (conversationId) => {
        socket.join(conversationId);
    });
    // ================= CHAT =================
    socket.on("send-message", async ({ toUserId, conversationId, message = "", file = null }) => {
        try {
            if (!socket.userId || socket.userId === toUserId) return;
            const senderId = socket.userId;

            // Find or create conversation
            // let conversation = await Conversation.findOne({
            //     participants: { $all: [senderId, toUserId] }
            // });

            // if (!conversation) {
            //     conversation = await Conversation.create({
            //         participants: [senderId, toUserId]
            //     });
            // }
            const conversation = await Conversation.findById(conversationId);

            if (!conversation) return;
            // Save message
            const msg = await Message.create({
                conversationId: conversation._id,
                sender: senderId,
                message: message || "",
                file: file || null
            });

            // Update conversation
            conversation.lastMessage = message
                ? message
                : file
                    ? "📎 Attachment"
                    : "";
            conversation.lastMessageAt = new Date();
            await conversation.save();


            // Emit to receiver
            const receiverSocket = onlineUsers.get(toUserId);
            const receiver = await User.findById(toUserId);

            if (receiver?.fcmToken) {
                await sendPush({
                    token: receiver.fcmToken,
                    title: "New Message",
                    body: message || "📩 New message received",
                    data: {
                        type: "chat",
                        conversationId: conversation._id.toString(),
                        fromUserId: socket.userId.toString()
                    }
                });
            }
            if (receiverSocket || conversationId) {
                const sender = await User.findById(senderId).select("name");

                io.to(receiverSocket || conversationId).emit("receive-message", {
                    conversationId: conversation._id,
                    sender: {
                        _id: senderId,
                        name: sender.name
                    },
                    message: msg.message,
                    file: msg.file,
                    createdAt: msg.createdAt
                });
            }

        } catch (err) {
            console.error("Chat error:", err);
        }
    });

    // ================= CALL SIGNALING =================
    socket.on("call-user", async ({
        toUserId,
        conversationId,
        callType,
        offer,
        isGroup = false
    }) => {
        socket.isCaller = true;
        socket.currentCallConversationId = conversationId;
        if (activeCalls.has(socket.userId)) {
            io.to(socket.id).emit("call-busy", {
                message: "You are already on another call"
            });
            return;
        }

        const callerId = socket.userId;
        groupCallParticipants.set(conversationId, new Set([callerId]));

        // 🟢 GROUP CALL
        if (isGroup) {

            const conversation = await Conversation.findById(conversationId);
            if (!conversation) return;
            socket.join(conversationId);

            const participants = conversation.participants.filter(
                id => id.toString() !== callerId.toString()
            );

            activeCalls.add(callerId);

            socket.callStartTime = new Date();
            socket.callLog = await CallLog.create({
                caller: callerId,
                group: conversationId,
                callType,
                startTime: socket.callStartTime
            });

            for (const userId of participants) {
                if (activeCalls.has(userId.toString())) continue;

                const receiverSocket = onlineUsers.get(userId.toString());
                // console.log(activeCalls,userId,onlineUsers)
                const receiver = await User.findById(userId);

                // 📲 Push
                if (receiver?.fcmToken) {
                    const from = await User.findById(callerId);
                    await sendPush({
                        token: receiver.fcmToken,
                        title: `Incoming Group Call`,
                        body: callType === "video" ? "📹 Video Call" : "📞 Voice Call",
                        data: {
                            type: "group-call",
                            conversationId,
                            fromUserId: callerId.toString()
                        }
                    });
                }
                if (receiverSocket) {
                    io.to(receiverSocket).emit("incoming-group-call", {
                        fromUserId: callerId,
                        conversationId,
                        offer,
                        callType, name: conversation.name, photo: conversation.image ? process.env.BACKEND_URL + '/' + conversation.image : ""
                    });
                }
            }

            return;
        }

        // 🔵 INDIVIDUAL CALL
        if (activeCalls.has(toUserId)) {
            io.to(socket.id).emit("call-busy", {
                message: "User is busy"
            });
            return;
        }

        activeCalls.add(callerId);
        activeCalls.add(toUserId);

        socket.callStartTime = new Date();
        socket.callLog = await CallLog.create({
            caller: callerId,
            receiver: toUserId,
            callType,
            startTime: socket.callStartTime
        });

        const receiverSocket = onlineUsers.get(toUserId);
        const receiver = await User.findById(toUserId);
        if (!receiverSocket) {
            // Caller ko turant batao — activeCalls se bhi hata do
            activeCalls.delete(callerId);
            activeCalls.delete(toUserId);
            io.to(socket.id).emit("call-user-offline", {
                message: "User is offline"
            });
            return;
        }
        if (receiver?.fcmToken) {
            const from = await User.findById(callerId);
            // await sendPush({
            //     token: receiver.fcmToken,
            //     title: `Incoming Call`,
            //     body: callType === "video" ? "📹 Video Call" : "📞 Voice Call",
            //     data: {
            //         type: "call",
            //         callType,
            //         fromUserId: callerId.toString()
            //     }
            // });
        }

        if (receiverSocket) {
            const caller = await User.findById(callerId).select("patientId doctorId labId pharId hospitalId role name")
                .populate("patientId doctorId", "profileImage").populate('labId pharId', 'logo').populate('hospitalId', 'logoFileId');
            let callerName = caller?.name;
            let callerPhoto = "";
            if (caller.role == "patient") {
                callerPhoto = caller.patientId?.profileImage ? process.env.BACKEND_URL + '/' + caller.patientId?.profileImage : "";
            } else if (caller.role == "doctor") {
                callerPhoto = caller.doctorId?.profileImage ? process.env.BACKEND_URL + '/' + caller.doctorId?.profileImage : "";
            } else if (caller.role == "lab") {
                callerPhoto = caller.labId?.logo ? process.env.BACKEND_URL + '/' + caller.labId?.logo : "";
            } else if (caller.role == "pharmacy") {
                callerPhoto = caller.pharId?.logo ? process.env.BACKEND_URL + '/' + caller.pharId?.logo : "";
            } else if (caller.role == "hospital") {
                callerPhoto = caller.hospitalId?.logoFileId ? process.env.BACKEND_URL + '/api/file/' + caller.hospitalId?.logoFileId : "";
            }
            io.to(receiverSocket).emit("incoming-call", {
                fromUserId: callerId,
                offer,
                callType, name: callerName, photo: callerPhoto
            });
        }
    });
    socket.on("set-availability", async (status) => {
        await User.findByIdAndUpdate(socket.userId, {
            isAvailable: status
        });
        io.emit("doctor-status-update", {
            doctorId: socket.userId,
            status
        });
    });
    socket.on("start-paid-chat", async ({ doctorId }) => {
        socket.chatSession = await ChatSession.create({
            doctor: doctorId,
            patient: socket.userId,
            startTime: new Date(),
            perMinuteCharge: 20,
            status: "active"
        });
    });
    socket.on("end-paid-chat", async () => {
        if (!socket.chatSession) return;

        const endTime = new Date();
        const minutes = Math.max(
            1,
            Math.ceil((endTime - socket.chatSession.startTime) / 60000)
        );

        socket.chatSession.endTime = endTime;
        socket.chatSession.totalAmount =
            minutes * socket.chatSession.perMinuteCharge;
        socket.chatSession.status = "ended";

        await socket.chatSession.save();
    });
    socket.on("typing", ({ toUserId }) => {
        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
            io.to(receiverSocket).emit("user-typing", {
                fromUserId: socket.userId
            });
        }
    });
    socket.on("stop-typing", ({ toUserId }) => {
        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
            io.to(receiverSocket).emit("user-stop-typing", {
                fromUserId: socket.userId
            });
        }
    });
    socket.on("end-call", async ({
        toUserId,
        conversationId,
        isGroup = false
    }) => {

        const callerId = socket.userId;

        activeCalls.delete(callerId);
        if (toUserId) activeCalls.delete(toUserId);
        let savedCallLog = null;
        if (socket.callLog) {
            socket.callLog.endTime = new Date();
            socket.callLog.duration =
                (socket.callLog.endTime - socket.callLog.startTime) / 1000;

            socket.callLog.status =
                socket.callLog.duration < 2 ? "missed" : "completed";

            await socket.callLog.save();
            savedCallLog = socket.callLog;
            socket.callLog = null;
        }

        // 🟢 GROUP
        if (isGroup) {
            const callerId = savedCallLog?.caller?.toString();

            // Agar caller ne end kiya
            if (socket.userId === callerId) {
                io.to(conversationId).emit("call-ended");
            } else {
                // user left
                socket.to(conversationId).emit("user-left-call", {
                    userId: socket.userId
                });
            }

            activeCalls.delete(socket.userId);
            return;
        }

        // 🔵 INDIVIDUAL
        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
            io.to(receiverSocket).emit("call-ended");
        }

        io.to(socket.id).emit("call-ended");
    });

    socket.on("answer-call", ({
        toUserId,
        conversationId,
        answer,
        isGroup = false
    }) => {

        if (isGroup) {
            activeCalls.add(socket.userId);

            if (!groupCallParticipants.has(conversationId)) {
                groupCallParticipants.set(conversationId, new Set());
            }

            groupCallParticipants.get(conversationId).add(socket.userId);

            socket.to(conversationId).emit("group-call-answered", {
                fromUserId: socket.userId,
                answer
            });

            return;
        }

        const callerSocket = onlineUsers.get(toUserId);
        if (callerSocket) {
            io.to(callerSocket).emit("call-answered", { answer });
        }
    });
    socket.on("ice-candidate", ({
        toUserId,
        conversationId,
        candidate,
        isGroup = false
    }) => {

        if (isGroup) {
            socket.to(conversationId).emit("ice-candidate", {
                fromUserId: socket.userId,
                candidate
            });
            return;
        }

        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
            io.to(receiverSocket).emit("ice-candidate", candidate);
        }
    });
    socket.on("reject-call", async ({
        toUserId,
        conversationId,
        isGroup = false
    }) => {

        const userId = socket.userId;

        activeCalls.delete(userId); // ✅ sirf apna remove karo

        if (socket.callLog) {
            socket.callLog.endTime = new Date();
            socket.callLog.status = "rejected";
            await socket.callLog.save();
            socket.callLog = null;
        }

        if (isGroup) {
            // ❗ IMPORTANT: only notify others, NOT end call
            socket.to(conversationId).emit("user-rejected-call", {
                userId
            });

            return;
        }

        // individual call
        const callerSocketId = onlineUsers.get(toUserId);
        if (callerSocketId) {
            io.to(callerSocketId).emit("call-rejected", {
                fromUserId: userId
            });
        }
    });
    socket.on("disconnect", async () => {
        activeCalls.delete(socket.userId); // add this

        if (socket.callLog?.group) {
            io.to(socket.callLog.group).emit("call-ended");
        }
        if (socket.userId) {
            console.log("disconnecting user", socket.userId)
            onlineUsers.delete(socket.userId);

            await User.findByIdAndUpdate(socket.userId, {
                isOnline: false,
                isAvailable: false,
                lastSeen: new Date()
            });

            io.emit("online-users", Array.from(onlineUsers.keys()));
        }

        console.log("❌ Socket disconnected:", socket.id);
    });

});

app.use('/patient', patient)
app.use('/doctor', doctor)
app.use('/appointment', appointment)
app.use('/lab', lab)
app.use('/pharmacy', pharmacy)
app.use('/admin', admin)
app.use("/api/neo", optimizeApi);
app.use("/api/staff", staff);
app.use("/api/department", department);
app.use('/api/certificate', certificate)

app.use('/user/:id', async (req, res) => {
    const userId = req.params.id
    try {
        let user;
        if (userId?.length < 24) {
            user = await User.findOne({ nh12: userId }).select('-passwordHash').lean();
        } else {
            user = await User.findOne({ _id: userId }).select('-passwordHash').lean();
        }
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        // const ptDemographic=await PatientDemographic.findOne({userId:user._id}).sort({createdAt:-1})
        if (user.role == "patient") {
            const finalUserId = user._id
            const [
                kyc,
                personal,
                history,
                familyHistory,
            ] = await Promise.all([
                PatientKyc.findOne({ userId: finalUserId }),
                PatientDemographic.findOne({ userId: finalUserId }),
                MedicalHistory.findOne({ userId: finalUserId }),
                MedicalHistory.findOne({
                    userId: finalUserId,
                    familyHistory: { $ne: null }
                }),
            ]);

            let nextStep = null;

            if (!kyc) {
                nextStep = "/kyc";
            } else if (!personal) {
                nextStep = "/personal-info";
            } else if (!history) {
                nextStep = "/medical-history";
            } else if (!familyHistory) {
                nextStep = "/family-medical-history";
            }
            return res.status(200).json({
                success: true,
                data: user, nextStep
            });
        } else if (user.role == "doctor") {
            const finalUserId = user._id
            const [
                kyc,
                education,
                license,
                about, clinic
            ] = await Promise.all([
                DoctorKyc.findOne({ userId: finalUserId }),
                DoctorEduWork.findOne({ userId: finalUserId }),
                MedicalLicense.findOne({ userId: finalUserId }),
                DoctorAbout.findOne({ userId: finalUserId }),
                DoctorClinic.findOne({ userId: finalUserId }),
            ]);

            let nextStep = null;

            if (!kyc) {
                nextStep = "/kyc";
            } else if (!education) {
                nextStep = "/education-work";
            } else if (!license) {
                nextStep = "/medical-license";
            } else if (!about) {
                nextStep = "/address-about";
            } else if (!clinic && about?.clinic) {
                nextStep = "/clinic";
            }
            return res.status(200).json({
                success: true,
                data: user, nextStep
            });
        }
        return res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        console.log(err)
        res.status(500).json({ success: false, message: err.message });
    }
})


const fileRoute = (await import("./routes/Hospital/fileRoute.js")).default;
const locationRoutes = (await import("./routes/Hospital/location.routes.js")).default;
const doctorRoutes = (await import("./routes/Hospital/hospitalDoctor.routes.js")).default;
const patientRoutes = (await import("./routes/Hospital/hospitalPatient.routes.js")).default;
const bedRoutes = (await import("./routes/Hospital/bed.routes.js")).default;
const commanRoutes = (await import("./routes/Hospital/comman.routes.js")).default;
const ipdDailyRoutes = (await import("./routes/Hospital/dailyNotes.routes.js")).default;

app.use("/api", fileRoute);
app.use("/api/chat", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/hospital", hospitalRoutes);
// app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminProfileRoutes);
app.use("/api/admin/patients", adminpatients);
app.use("/api/adminauth", adminauth);
app.use("/api/admin/faqs", faqRoutes);
app.use("/api/admin/notifications", notificationRoutes);
app.use("/api/admin/doctor", AdminDoctorRoutes);
app.use("/api/admin/cms", CmsPageRoutes);
app.use("/api/admin/lab", AdminLabRoutes);
app.use("/api/admin/staff", AdminStaffRoutes);
app.use("/api/admin/pharmacy", AdminPharmacyRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/hospital-doctor", doctorRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/bed", bedRoutes);
app.use("/api/comman", commanRoutes);
app.use("/api/ipd-note", ipdDailyRoutes);
app.use("/api/admin/landing", LandingPage);
app.use("/api/admin/location", locationRoutesAdmin);
app.use("/api/admin/edit-requests", editRequestRoutes);

app.use("/api/admin/suppliers", supplierRoutes);

app.use("/api/admin/hospitals", AdminhospitalRoutes);
app.use("/api/admin/social-links", AdminsocialRoutes);
// New routes - blogs, contact, ambulance
const blogRoutes = (await import("./routes/Admin/blog.routes.js")).default;
const contactRoutes = (await import("./routes/Admin/contact.routes.js")).default;
const ambulanceRoutes = (await import("./routes/patient.ambulance.routes.js")).default;

app.use("/api/admin/blogs", blogRoutes);
app.use("/api/contact", contactRoutes);
app.use("/patient", ambulanceRoutes);





server.listen(process.env.PORT, () => {
    console.log("Start")
})