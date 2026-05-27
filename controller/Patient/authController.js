

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sendEmail from '../../utils/sendMail.js'
import Otp from '../../models/Otp.js';
import Patient from '../../models/Patient/patient.model.js';
import Login from '../../models/login.js';
import PatientKyc from '../../models/Patient/kyc.model.js';
import fs from 'fs'
import PatientDemographic from '../../models/Patient/demographic.model.js';
import MedicalHistory from '../../models/Patient/medicalHistory.model.js';
import EditRequest from '../../models/EditRequest.js';
import LabAppointment from '../../models/LabAppointment.js';
import safeUnlink, { generateOTP, sendEmailOtp, sendMobileOtp, sendWelcomeEmail } from '../../utils/globalFunction.js';
import PatientPrescriptions from '../../models/Patient/prescription.model.js';
import User from '../../models/Hospital/User.js';
import DoctorAppointment from '../../models/DoctorAppointment.js';
import BlockUser from '../../models/BlockUser.js';
import Country from '../../models/Hospital/Country.js';
import { assignNH12 } from '../../utils/nh12.js';
import sendPatientEmail from '../../utils/sendTemplateEmail.js';

const signUpPatient = async (req, res) => {
    const { name, gender, email, contactNumber, password, created_by } = req.body;
    try {
        const [userByEmail, userByContact, patientExists] = await Promise.all([
            User.findOne({ email }),
            User.findOne({ contactNumber }),
            Patient.findOne({ $or: [{ email }, { contactNumber }] })
        ]);

        if (userByEmail || userByContact || patientExists) {
            return res.status(200).json({ success: false, message: "Patient already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user       
        const newPatient = await Patient.create({
            name,
            gender,
            email,
            contactNumber,
        });

        if (newPatient) {
            const code = generateOTP()
            await sendMobileOtp(contactNumber, code)

            const isOtpExist = await Otp.findOne({ phone: contactNumber })
            if (isOtpExist) {
                await Otp.findByIdAndDelete(isOtpExist._id)
                const otp = await Otp.create({ phone: contactNumber, code })
            } else {
                const otp = await Otp.create({ phone: contactNumber, code })
            }
            const user = await User.create(
                {
                    patientId: newPatient?._id,
                    email,
                    name,
                    role: 'patient',
                    created_by: 'self',
                    contactNumber,
                    passwordHash: hashedPassword
                },
            )
            sendPatientEmail("Email Template/patient/otp.html", { code, name: name || "Patient" },
                "Verify Your Account", user._id)

            await Patient.findByIdAndUpdate(newPatient._id, { userId: user._id }, { new: true })
            return res.status(200).json({ success: true, userId: user._id });
        } else {
            return res.status(200).json({ success: false, message: "Patient not created" });
        }

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: err.message });
    }
}
const signInPatient = async (req, res) => {
    const { contactNumber, password, email, withOtp } = req.body;
    try {
        const isExist = contactNumber ? await User.findOne({ contactNumber, role: "patient" }) : await User.findOne({ email, role: "patient" });
        if (!isExist) return res.status(200).json({ message: 'Patient not Found', success: false });
        const hashedPassword = isExist.passwordHash
        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) return res.status(200).json({ message: 'Invalid credentials', success: false });
        if (withOtp) {
            const code = generateOTP()
            if (contactNumber && contactNumber !== "7375046291") {
                await sendMobileOtp(contactNumber, code)
            } if (email) {
                sendPatientEmail("Email Template/patient/otp.html", { code, name: isExist?.name || "Patient" },
                    "Verify Your Account", isExist._id)
                // await sendEmailOtp(email, code)
            }
            const isOtpExist = await Otp.findOne({ phone: contactNumber, email })
            if (isOtpExist) {
                await Otp.findByIdAndDelete(isOtpExist._id)
                const otp = await Otp.create({ phone: contactNumber, email, code })
            } else {
                const otp = await Otp.create({ phone: contactNumber, email, code })
            }

            const isLogin = await Login.findOne({ userId: isExist._id })
            if (isLogin) {
                await Login.findByIdAndUpdate(isLogin._id, {}, { new: true })
                return res.status(200).json({ message: "Code Sent", code, userId: isExist._id, isNew: false, success: true })
            } else {
                await Login.create({ userId: isExist._id })
                return res.status(200).json({ message: "Code Sent", code, isNew: true, userId: isExist._id, success: true })
            }
        } else {
            const userId = isExist._id;
            const [
                kyc,
                personal,
                history,
                familyHistory,
                prescription
            ] = await Promise.all([
                PatientKyc.findOne({ userId }),
                PatientDemographic.findOne({ userId }),
                MedicalHistory.findOne({ userId }),
                MedicalHistory.findOne({
                    userId,
                    familyHistory: { $ne: null }
                }),
                PatientPrescriptions.findOne({ userId })
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

            // Check if this is a new login
            let isNew = true;
            const isLogin = await Login.findOne({ userId });
            if (isLogin) {
                isNew = false;
            }

            // Generate JWT token
            const token = jwt.sign(
                { user: isExist._id },
                process.env.JWT_SECRET,
                { expiresIn: "1y" }
            );
            return res.status(200).json({
                message: "Verify Success",
                nextStep,
                token,
                userId,
                user: isExist,
                success: true
            });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server Error' });
    }
}
const verifyOtp = async (req, res) => {
    const { code, email, contactNumber, type } = req.body;

    try {
        // Determine which identifier to use (contactNumber or email)
        const identifier = contactNumber || email;

        // Find OTP by either phone or email
        const query = {};
        if (contactNumber) {
            query.phone = contactNumber;
        }
        if (email) {
            query.email = email;
        }
        query.code = code;

        const isOtp = await Otp.findOne(query);
        const dummyUser = contactNumber ? await User.findOne({ contactNumber, created_by: "admin" }) : await User.findOne({ email, created_by: "admin" })

        // Hardcoded bypass for specific contact number
        if (!isOtp && contactNumber !== "9917141332" && contactNumber !== "7375046291" && email !== "test@example.com" && !dummyUser) {
            return res.status(200).json({ message: "Code not exist", success: false });
        }

        // Check OTP expiry
        if (isOtp) {
            const otpExpiryTime = new Date(isOtp.updatedAt);
            otpExpiryTime.setMinutes(otpExpiryTime.getMinutes() + 10);

            if (new Date() > otpExpiryTime && contactNumber !== "9917141332" && contactNumber !== "7375046291" && email !== "test@example.com") {
                return res.status(200).json({ message: "OTP Expired", success: false });
            }
        }

        // Validate OTP code
        let isValid = false;

        if (contactNumber == "9917141332" || contactNumber == "7375046291" || dummyUser) {
            isValid = code == "123456";
        } else if (email == "test@example.com") { // Add your test email if needed
            isValid = code == "123456";
        } else {
            isValid = code == isOtp?.code;
        }

        if (!isValid) {
            return res.status(200).json({ message: "Invalid OTP", success: false });
        }

        // Find user based on identifier (contactNumber or email)
        let user;
        if (contactNumber) {
            const patient = await User.findOne({ contactNumber });
            if (!patient) {
                return res.status(200).json({ message: "Patient not found", success: false });
            }
            user = await User.findById(patient._id);
        } else if (email) {
            user = await User.findOne({ email });
            if (!user) {
                return res.status(200).json({ message: "User not found", success: false });
            }
        }


        if (!user) {
            return res.status(200).json({ message: "User not found", success: false });
        }

        const userId = user._id;

        if (type === "forgot-password") {
            const token = jwt.sign(
                { user: user._id },
                process.env.JWT_SECRET,
                { expiresIn: "5m" }
            );
            return res.status(200).json({
                message: "Verify successfully",
                success: true, token

            });
        }

        // Check user onboarding steps
        const [
            kyc,
            personal,
            history,
            familyHistory,
            prescription
        ] = await Promise.all([
            PatientKyc.findOne({ userId }),
            PatientDemographic.findOne({ userId }),
            MedicalHistory.findOne({ userId }),
            MedicalHistory.findOne({
                userId,
                familyHistory: { $ne: null }
            }),
            PatientPrescriptions.findOne({ userId })
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

        // Check if this is a new login
        let isNew = true;
        const isLogin = await Login.findOne({ userId });
        if (isLogin) {
            isNew = false;
        }

        // Generate JWT token
        const token = jwt.sign(
            { user: user._id },
            process.env.JWT_SECRET,
            // { expiresIn: isRemember ? "30d" : "1d" }
        );

        // Clean up used OTP
        if (isOtp) {
            await Otp.findByIdAndDelete(isOtp._id);
        }

        return res.status(200).json({
            message: "Verify Success",
            nextStep,
            token,
            patientId: user?.patientId,
            userId,
            user: user,
            success: true
        });

    } catch (err) {
        console.log(err);
        return res.status(400).json({ success: false, error: err.message });
    }
};
const resendOtp = async (req, res) => {
    const { contactNumber, email } = req.body;
    try {
        const isExist = contactNumber ? await User.findOne({ contactNumber }) : await User.findOne({ email });
        if (!isExist) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }
        const code = generateOTP()
        if (contactNumber) {

            await sendMobileOtp(contactNumber, code)
        } else {
            sendPatientEmail("Email Template/patient/otp.html", { code, name: isExist?.name || "Patient" },
                "Verify Your Account", isExist._id)
            // await sendEmailOtp(email, code)
        }
        const isOtpExist = await Otp.findOne({ phone: contactNumber, email })
        if (isOtpExist) {
            await Otp.findByIdAndDelete(isOtpExist.contactNumber)
            const otp = await Otp.create({ phone: contactNumber, email, code })
        } else {
            const otp = await Otp.create({ phone: contactNumber, email, code })
        }

        res.status(200).json({
            success: true,
            message: "OTP sent!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
const sendOtp = async (req, res) => {
    const { contactNumber } = req.body;
    try {
        const isExist = await Patient.findOne({ contactNumber });
        if (!isExist) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }
        const code = generateOTP()
        await sendMobileOtp(contactNumber, code)
        const isOtpExist = await Otp.findOne({ phone: contactNumber })
        if (isOtpExist) {
            await Otp.findByIdAndDelete(isOtpExist.contactNumber)
            const otp = await Otp.create({ phone: contactNumber, code })
        } else {
            const otp = await Otp.create({ phone: contactNumber, code })
        }
        // const emailHtml = `
        //     Hello ${isExist?.name}, 
        //     Your One-Time Password (OTP) for Neo Health is: ${code} 
        //     This OTP is valid for 10 minutes. Please do not share it with anyone.
        //     If you did not request this, please ignore this email.
        //     Thank you,
        //     The Neo Health Team`
        // await sendEmail({
        //     to: isExist.email,
        //     subject: "Your Neo Health OTP Code!",
        //     html: emailHtml
        // });
        res.status(200).json({
            success: true, code,
            message: "OTP sent!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const forgotPassword = async (req, res) => {
    const { contactNumber } = req.body
    try {
        const isExist = await User.findOne({ contactNumber, role: "patient" });
        if (!isExist) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }
        const code = generateOTP()
        await sendMobileOtp(contactNumber, code)
        const isOtpExist = await Otp.findOne({ phone: contactNumber })
        if (isOtpExist) {
            await Otp.findByIdAndDelete(isOtpExist._id)
            const otp = await Otp.create({ phone: contactNumber, code })
        } else {
            const otp = await Otp.create({ phone: contactNumber, code })
        }

        return res.status(200).json({
            success: true,
            message: "Otp sent!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const resetPassword = async (req, res) => {
    const { password } = req.body;

    const userId = req.user.userId
    try {

        const isExist = await User.findById(userId);
        if (!isExist) return res.status(400).json({ message: 'Invalid user' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const updatePass = await User.findByIdAndUpdate(userId, { passwordHash: hashedPassword }, { new: true })
        if (updatePass) {
            return res.status(200).json({ message: "Password reset", userId: isExist._id, success: true })
        } else {
            return res.status(200).json({ message: "Error occure in password reset", success: false })
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ message: err?.message });
    }
}
const changePassword = async (req, res) => {
    const { newPassword, oldPassword } = req.body;
    const userId = req.user.userId
    try {
        const isExist = await User.findById(userId);
        if (!isExist) return res.status(200).json({ message: 'User not found' });
        const isMatch = await bcrypt.compare(oldPassword, isExist.passwordHash);
        if (!isMatch) return res.status(200).json({ message: 'Old password is incorrect', success: false });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const updatePass = await User.findByIdAndUpdate(userId, { passwordHash: hashedPassword }, { new: true })
        if (updatePass) {
            return res.status(200).json({ message: "Password change successfully", userId: isExist._id, success: true })
        } else {
            return res.status(200).json({ message: "Error occure in password reset", success: false })
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ message: err?.message });
    }
}

const updatePatient = async (req, res) => {
    const { userId, email, contactNumber, name, gender } = req.body;
    const profileImage = req.files?.['profileImage']?.[0]?.path
    try {
        const isExist = await User.findById(userId);
        if (!isExist) return res.status(200).json({ message: 'Patient not exist' });
        const patient = await Patient.findById(isExist.patientId)
        if (!patient) {
            return res.status(400).json({ message: 'Patient not exist' });
        }

        // check email in User collection
        const patientEmailExist = await User.findOne({
            email,
            _id: { $ne: userId }
        });

        if (patientEmailExist) {
            return res.status(400).json({ message: 'Email already exist' });
        }

        // check contact number in User collection
        const userContactExist = await User.findOne({
            contactNumber,
            _id: { $ne: userId }
        });

        if (userContactExist) {
            return res.status(400).json({ message: 'Contact number already exist' });
        }
        if (profileImage && patient.profileImage) {
            safeUnlink(patient.profileImage)
        }
        const updatePatient = await Patient.findByIdAndUpdate(isExist.patientId, { email, contactNumber, name, gender, profileImage }, { new: true })
        if (updatePatient) {
            await User.findOneAndUpdate({ patientId: userId }, { name, email, contactNumber }, { new: true })
            return res.status(200).json({ message: "Patient data change successfully", userId: isExist._id, success: true })
        } else {
            return res.status(200).json({ message: "Error occure in user data", success: false })
        }
    } catch (err) {
        if (fs.existsSync(profileImage)) {
            safeUnlink(profileImage)
        }
        console.error(err.message);
        if (err.message.includes(' duplicate key error collection')) {
            return res.status(200).json({ message: "Email already exist " })
        } else {
            return res.status(200).json({ message: 'Server Error' });
        }
    }
}

const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userIdId).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
const getCustomProfile = async (req, res) => {
    const userId = req.params.id
    try {
        let user;
        if (userId?.length == 12) {
            user = await User.findOne({ nh12: userId, role: 'patient' }).select('-passwordHash').lean();
        } else if (userId?.length < 24) {
            user = await User.findOne({ unique_id: userId, role: "patient" }).select('-passwordHash').lean();
        } else {
            user = await User.findById(userId).select('-passwordHash').lean();
        }
        if (!user) {
            return res.status(200).json({ success: false, message: 'Patient not found' });
        }
        const patientData = await Patient.findById(user.patientId).lean()
        const ptDemographic = await PatientDemographic.findOne({ userId: user._id }).lean().sort({ createdAt: -1 })

        return res.status(200).json({
            success: true, customId: user.nh12, userId: user._id,
            data: { ...patientData, ...ptDemographic }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
const getProfileDetail = async (req, res) => {
    try {
        const userId = req.params.id;

        // Determine if it's ObjectId or unique_id
        const isObjectId = userId?.length === 24;

        const user = await User
            .findOne(isObjectId ? { $or: [{ _id: userId }, { patientId: userId }] } : { unique_id: userId })
            .select('-passwordHash')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        const fullId = user._id;

        // Run all queries in parallel
        const [
            patient,
            kyc,
            medicalHistory,
            demographic,
            prescription, isRequest, allowEdit, doctorAppointmentsCount,
            labAppointmentsCount
        ] = await Promise.all([
            Patient.findOne({ userId: fullId }).lean(),
            PatientKyc.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
            MedicalHistory.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
            PatientDemographic.findOne({ userId: fullId }).populate('countryId stateId cityId').sort({ createdAt: -1 }).lean(),
            PatientPrescriptions.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
            EditRequest.findOne({ patientId: fullId }),
            EditRequest.exists({ patientId: fullId, status: 'approved' }).then(Boolean),
            DoctorAppointment.countDocuments({ patientId: fullId }),  // Count doctor appointments
            LabAppointment.countDocuments({ patientId: fullId })
        ]);

        const notAllowed = (patient?.status !== 'approved') && ((doctorAppointmentsCount + labAppointmentsCount) > 5);

        return res.status(200).json({
            success: true,
            user: patient, patientUser: user,
            kyc, customId: user.unique_id, role: user.role,
            demographic,
            prescription,
            medicalHistory, isRequest, allowEdit, notAllowed
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
const getPatientProfile = async (req, res) => {
    try {
        const userId = req.params.id;

        // Determine if it's ObjectId or unique_id
        const isObjectId = userId?.length === 24;

        const user = await User
            .findOne(isObjectId ? { _id: userId } : { nh12: userId })
            .select('-passwordHash')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        const fullId = user._id;

        // Run all queries in parallel
        const [
            patient,
            medicalHistory,
            demographic,
            prescription,
        ] = await Promise.all([
            Patient.findOne({ userId: fullId }).lean(),
            MedicalHistory.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
            PatientDemographic.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
            PatientPrescriptions.findOne({ userId: fullId }).sort({ createdAt: -1 }).lean(),
        ]);

        return res.status(200).json({
            success: true,
            user: patient, patientUser: user,
            customId: user.unique_id, role: user.role,
            demographic,
            prescription,
            medicalHistory,
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const deletePatient = async (req, res) => {
    const userId = req.user.userIdId
    try {
        const user = await Patient.findById(userId)
        if (!user) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }
        await Otp.deleteMany({ userId })
        await Login.deleteMany({ userId })
        await User.findOneAndDelete({ patientId: userId })
        await Patient.findByIdAndDelete(userId)
        return res.status(200).json({
            success: true,
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const patientKyc = async (req, res) => {
    const { type } = req.body;
    const frontImage = req.files?.['frontImage']?.[0]?.path
    const backImage = req.files?.['backImage']?.[0]?.path
    const userId = req.user.userId
    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })
        const data = await PatientKyc.findOne({ userId });
        if (data) {
            if (frontImage && data.frontImage) {
                safeUnlink(data.frontImage)
            }
            if (backImage && data.backImage) {
                safeUnlink(data.backImage)
            }
            await PatientKyc.findByIdAndUpdate(data._id, { frontImage, backImage, type }, { new: true })

            return res.status(200).json({
                success: true,
                message: "Kyc update successfully",
            });
        } else {
            await PatientKyc.create({ frontImage, backImage, userId, type })
            sendPatientEmail("Email Template/patient/welcome.html", { btnLink: process.env.PATIENT_URL + '/my-appointment' },
                "Welcome to NeoHealthCard", userId)

            return res.status(200).json({
                success: true,
                message: "Kyc saved successfully",
            });
        }
    } catch (error) {
        if (frontImage && fs.existsSync(frontImage)) {
            fs.unlinkSync(frontImage)
        }
        if (backImage && fs.existsSync(backImage)) {
            fs.unlinkSync(backImage)
        }
        console.error("Error saving profile image:", error);
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const patientDemographic = async (req, res) => {
    const { bloodGroup, height, weight, dob, contact, address, lat, long, stateId, countryId, cityId } = req.body;
    const userId = req.user.userId
    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await PatientDemographic.findOne({ userId });
        const countryData = await Country.findById(countryId)
        if (countryData) {
        }
        if (data) {
            await PatientDemographic.findByIdAndUpdate(data._id, { bloodGroup, height, weight, dob, contact, address, lat, long, stateId, countryId, cityId }, { new: true })

            return res.status(200).json({
                success: true,
                message: "Demographic update successfully",
            });
        } else {
            await assignNH12(userId, countryData?.phonecode)
            await PatientDemographic.create({ bloodGroup, height, weight, dob, userId, contact, address, lat, long, stateId, countryId, cityId })

            return res.status(200).json({
                success: true,
                message: "Demographic saved successfully",
            });
        }
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const patientLocation = async (req, res) => {
    const { address, lat, long, stateId, countryId, cityId, pinCode } = req.body;
    const userId = req.user.userId
    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await PatientDemographic.findOne({ userId });
        if (data) {
            await PatientDemographic.findByIdAndUpdate(data._id, { address, lat, long, stateId, countryId, cityId, pinCode }, { new: true })

            return res.status(200).json({
                success: true,
                message: "Demographic update successfully",
            });
        } else {
            await PatientDemographic.create({ userId, address, lat, long, stateId, countryId, cityId, pinCode })

            return res.status(200).json({
                success: true,
                message: "Demographic saved successfully",
            });
        }
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const getPatientDemographic = async (req, res) => {
    const userId = req.params.id;

    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await PatientDemographic.findOne({ userId });

        return res.status(200).json({
            success: true,
            data,
            message: "Demographic fetch successfully",
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const getPatientKyc = async (req, res) => {
    const userId = req.params.id;

    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })
        const pt = await Patient.findOne({ userId: user._id })
        const data = await PatientKyc.findOne({ userId });
        if (data) {
            return res.status(200).json({
                success: true,
                data,
                status: pt.status,
                message: "Kyc fetch successfully",
            });
        }
        return res.status(200).json({
            success: false,
            message: "Kyc not found ",
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const patientMedicalHistory = async (req, res) => {
    const { userId, alcohol, smoking, allergies, medicationDetail, onMedication, chronicCondition, familyHistory } = req.body;
    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await MedicalHistory.findOne({ userId });
        if (data) {
            await MedicalHistory.findByIdAndUpdate(data._id, { alcohol, smoking, allergies, medicationDetail, onMedication, chronicCondition, familyHistory }, { new: true })

            return res.status(200).json({
                success: true,
                message: "Medical History update successfully",
            });
        } else {
            await MedicalHistory.create({ alcohol, smoking, allergies, medicationDetail, onMedication, chronicCondition, familyHistory, userId })
            await sendWelcomeEmail(userId)
            return res.status(200).json({
                success: true,
                message: "Medical History saved successfully",
            });
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const getMedicalHistory = async (req, res) => {
    const userId = req.params.id;

    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await MedicalHistory.findOne({ userId });
        if (data) {
            return res.status(200).json({
                success: true,
                data,
                message: "Medical History fetch successfully",
            });
        }

        return res.status(200).json({
            success: false,
            message: "Medical History not found",
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const familyMedicalHistory = async (req, res) => {
    const { familyHistory } = req.body;
    const userId = req.user.userId
    try {
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })

        const data = await MedicalHistory.findOne({ userId });
        if (data) {
            await MedicalHistory.findByIdAndUpdate(data._id, { familyHistory }, { new: true })

            return res.status(200).json({
                success: true,
                message: "Medical History update successfully",
            });
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const addPrescriptions = async (req, res) => {
    try {
        const userId = req.user.userId
        const user = await User.findById(userId)
        if (!user) return res.status(200).json({ message: "User not found", success: false })
        let prescriptionsData = req.body.prescriptions;
        // If prescriptions data comes as JSON string (from multipart/form-data), parse it
        if (typeof prescriptionsData === "string") {
            try {
                prescriptionsData = JSON.parse(prescriptionsData);
            } catch (err) {
                return res.status(400).json({ success: false, error: "Invalid prescriptions data JSON" });
            }
        }

        // Ensure prescriptionsData is an array
        if (!Array.isArray(prescriptionsData)) {
            prescriptionsData = [prescriptionsData];
        }

        const files = req.files || [];

        // Find existing prescriptions document for the user
        let userPrescriptionsDoc = await PatientPrescriptions.findOne({ userId });

        if (!userPrescriptionsDoc) {
            // No existing doc, create new one
            // Attach uploaded file paths to prescriptions
            prescriptionsData.forEach((prescription, i) => {
                if (prescription && files[i]) {
                    prescription.fileUrl = files[i].path;
                }
            });
            const created = await PatientPrescriptions.create({
                userId,
                prescriptions: prescriptionsData,
            });

            return res.status(201).json({
                success: true,
                message: "Prescriptions created successfully",
                data: created,
            });
        }

        // If doc exists, update or add prescriptions
        prescriptionsData.forEach((newPresc, index) => {
            if (!newPresc) return; // skip if undefined

            const existingPresc = userPrescriptionsDoc.prescriptions.id(newPresc._id);

            if (existingPresc) {
                // Update existing prescription
                if (files[index]) {
                    safeUnlink(existingPresc.fileUrl);
                    existingPresc.fileUrl = files[index].path;
                }

                existingPresc.name = newPresc.name || existingPresc.name;
                existingPresc.diagnosticName = newPresc.diagnosticName || existingPresc.diagnosticName;
                // update other fields similarly if needed

            } else {
                // Add new prescription
                if (files[index]) {
                    newPresc.fileUrl = files[index].path;
                }
                userPrescriptionsDoc.prescriptions.push(newPresc);
            }
        });

        await userPrescriptionsDoc.save();

        return res.status(200).json({
            success: true,
            message: "Prescriptions updated successfully",
            data: userPrescriptionsDoc,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
    }
};




const deletePrescription = async (req, res) => {
    try {
        const { id, itemId } = req.params;

        const record = await PatientPrescriptions.findById(id);
        const item = record.prescriptions.id(itemId);

        if (!item) return res.status(404).json({ success: false, message: "Not found" });

        safeUnlink(item.fileUrl);

        item.deleteOne();
        await record.save();

        return res.json({ success: true, message: "Prescription deleted" });

    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
const updateImage = async (req, res) => {
    const userId = req.user.userId
    const image = req.files?.['profileImage']?.[0]?.path
    try {
        const user = await Patient.findById(userId)
        if (!user) return res.status(200).json({ message: "Patient not found", success: false })

        if (user.image) {
            safeUnlink(user.profileImage)
        }
        await Doctor.findByIdAndUpdate(user._id, { profileImage: image }, { new: true })

        return res.status(200).json({
            success: true,
            message: "Profile image saved successfully",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const editRequest = async (req, res) => {
    const { message } = req.body;
    const patientId = req.user.userId
    try {
        const user = await User.findById(patientId)
        if (!user) return res.status(200).json({ message: "Patient not found", success: false })


        await EditRequest.create({ patientId, message, type: 'patient' })

        return res.status(200).json({
            success: true,
            message: "Request successfully send to admin",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error?.message,
        });
    }
};
const getNameProfile = async (req, res) => {
    const name = req.params.name;

    try {
        const users = await Patient.find({ name: { $regex: name, $options: "i" } })
            .select('-password')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No users found with that name"
            });
        }

        return res.status(200).json({
            success: true,
            data: users
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

export {
    signInPatient, updateImage, addPrescriptions, getProfileDetail, editRequest, deletePrescription, signUpPatient, resetPassword, patientKyc, patientDemographic, patientMedicalHistory, forgotPassword, verifyOtp, resendOtp, getProfile, updatePatient, changePassword, deletePatient,
    getPatientDemographic, getCustomProfile, getNameProfile, familyMedicalHistory, getPatientKyc, getMedicalHistory, getPatientProfile,
    sendOtp, patientLocation
}