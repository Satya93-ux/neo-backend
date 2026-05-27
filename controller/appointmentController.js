import mongoose from "mongoose";
import DoctorAbout from "../models/Doctor/addressAbout.model.js";
import Doctor from "../models/Doctor/doctor.model.js";
import DoctorAppointment from "../models/DoctorAppointment.js";
import HospitalBasic from "../models/Hospital/HospitalBasic.js";
import User from "../models/Hospital/User.js";
import LabAppointment from "../models/LabAppointment.js";
import LabAddress from "../models/Laboratory/labAddress.model.js";
import Laboratory from "../models/Laboratory/laboratory.model.js";
import Test from "../models/Laboratory/test.model.js";
import LabTest from "../models/LabTest.js";
import Notification from "../models/Notifications.js";
import PatientDemographic from "../models/Patient/demographic.model.js";
import Patient from "../models/Patient/patient.model.js";
import Prescriptions from "../models/Prescriptions.js";
import Rating from "../models/Rating.js";
import TestReport from "../models/testReport.js";
import { sendPush } from "../utils/sendPush.js";

import DoctorAptPayment from "../models/DoctoAptPayment.js";
import PaymentInfo from "../models/PaymentInfo.js";
import StaffEmployement from "../models/Staff/StaffEmployement.js";
import Department from "../models/Department.js";
import PatientDepartment from "../models/Hospital/PatientDepartment.js";
import HospitalAddress from "../models/Hospital/HospitalAddress.js";
import sendPatientEmail, { sendDoctorEmail, sendLabEmail } from "../utils/sendTemplateEmail.js";
import AuditLog from "../models/AuditLog.js";

const bookDoctorAppointment = async (req, res) => {
    const { patientId, doctorId, date, hospitalId, status, } = req.body;
    const insertUser = req.user.id || req.user.userId
    let fees;
    let department;
    try {
        const isExist = await User.findOne({ role: 'doctor', _id: doctorId });
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });
        const isInsert = await User.findById(insertUser)
        const isPatient = await User.findOne({ role: 'patient', _id: patientId });
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });
        let location;
        let specialization = 'General';
        if (hospitalId) {
            const hospitalBasic = await HospitalBasic.findOne({ userId: hospitalId })
            const hospitalAddress = await HospitalAddress.findOne({ hospitalId: hospitalBasic._id }).populate('city')
            location = hospitalAddress.fullAddress + ',' + hospitalAddress?.city?.name + ',' + hospitalAddress?.pinCode
            const data = await StaffEmployement.findOne({ organizationId: hospitalId, userId: doctorId, status: 'active' })
            if (!data) {
                return res.status(404).json({ message: "Doctor is not employed at this hospital", success: false })
            }
            await PatientDepartment.create({ patientId, hospitalId, departmentId: data?.department })
            department = data?.department
            fees = data.fees
            const doctorAbout = await DoctorAbout.findOne({ userId: doctorId }).populate('specialty')
            specialization = doctorAbout?.specialty?.name
        } else {
            const doctorAbout = await DoctorAbout.findOne({ userId: doctorId }).populate('cityId specialty')
            location = doctorAbout.fullAddress + ',' + doctorAbout?.cityId?.name + ',' + doctorAbout?.pinCode
            fees = doctorAbout.fees
            specialization = doctorAbout?.specialty?.name
        }
        if (isInsert.role == "hospital" || isInsert.role == "doctor" || isInsert.role == "staff") {
            fees = Math.round(fees + (fees * 5 / 100));
        }
        const book = await DoctorAppointment.create({ patientId, department, doctorId, date, fees, hospitalId, status: isInsert.role == "hospital" ? "approved" : "pending" })
        if (book) {
            res.status(200).json({ message: "Appointment book successfully", success: true })
            if (!hospitalId) {
                await Notification.create({
                    userId: isExist._id,
                    title: "New Appointment",
                    message: `${isPatient?.name} has booked an appointment with you on ${new Date(date)?.toLocaleString('en-GB')}`
                })
                sendDoctorEmail("Email Template/doctor/PatientApt.html",
                    {
                        aptId: book.customId,
                        date: new Date(date).toLocaleDateString('en-GB'),
                        time: new Date(date).toLocaleTimeString('en-GB'),
                        patientName: isPatient.name,
                        name: isExist.name,
                        btnLink: process.env.DOCTOR_URL + `/detail-view/${isPatient?.name}/${book?._id}`,
                    },

                    "New Appointment Request", isExist._id)
            }
            if (isInsert.role == "patient") {
                let btnLink = process.env.PATIENT_URL + `/appointment-detail/${isExist?.name}/${book?._id}`
                sendPatientEmail("Email Template/patient/DoctorAptConfirmations.html",
                    {
                        aptId: book.customId, doctorName: isExist?.name || "Doctor",
                        date: new Date(date).toLocaleDateString('en-GB'),
                        time: new Date(date).toLocaleTimeString('en-GB'),
                        name: isPatient.name,
                        specialization,
                        btnLink,
                        location
                    },

                    "Doctor Appointment Confirmation", isPatient._id)
            }
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req.user.id || req.user.userId, actorId: req?.user?.loginUser || req.user.id || req.user.userId,
                    shortDesc: "New Appointment created",
                    method: "CREATE",
                    panel: req?.user?.type,
                    description: `Add an appointment with ${isPatient?.name} appointment id ${book.customId}.`
                })
            }

            if (isExist.fcmToken) {
                await sendPush({
                    token: isExist.fcmToken,
                    title: "New Appointment",
                    body: `${isPatient?.name} book a appointment on ${new Date(date)?.toLocaleTimeString('en-GB')}`,
                    data: {
                        type: "New Appointment",
                        time: Date.now().toString()
                    }
                });
            }
            if (isPatient.fcmToken) {
                await sendPush({
                    token: isPatient.fcmToken,
                    title: "New Appointment",
                    body: `You book  a appointment on ${new Date(date)?.toLocaleTimeString('en-GB')} with ${isExist?.name}`,
                    data: {
                        type: "New Appointment",
                        time: Date.now().toString()
                    }
                });
            }

        } else {
            return res.status(200).json({ message: "Appointment not booked", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const updateDoctorAppointment = async (req, res) => {
    const { patientId, doctorId, date, fees, labTest, appointmentId } = req.body;
    try {
        const isExist = await User.findOne({ role: 'doctor', _id: doctorId });
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });

        const isPatient = await User.findOne({ role: 'patient', _id: patientId });
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });
        const isLast = await DoctorAppointment.findOne().sort({ createdAt: -1 });
        const nextId = isLast
            ? String(Number(isLast.customId.slice(3)) + 1).padStart(4, "0")
            : "0001";

        const book = await DoctorAppointment.findByIdAndUpdate(appointmentId, { patientId, doctorId, date, fees, labTest }, { new: true })
        if (book) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type) && labTest) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Lab test added for an appointment`,
                    method: "CREATE",
                    panel: req?.user?.type,
                    description: `Lab test added to an appointment for ${isPatient?.name} appointment id ${book?.customId}.`
                })
            }
            return res.status(200).json({ message: "Appointment updated successfully", success: true })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const getDoctorAppointment = async (req, res) => {
    try {
        const doctorId = req.params.id;

        // Parse pagination params with defaults
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || '';
        const statuses = req.query.statuses || ''
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const todayApt = req.query.todayApt;

        const skip = (page - 1) * limit;

        let filter = { doctorId, hospitalId: null };
        if (status) {
            filter.status = status;
        }
        if (statuses) {
            filter.status = { $in: statuses.split(',') };
        }
        if (todayApt) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            filter.date = {
                $gte: startOfDay,
                $lte: endOfDay
            };
        }
        const start = startDate && startDate !== 'null' ? new Date(startDate) : null;
        const end = endDate && endDate !== 'null' ? new Date(endDate) : null;

        if (start || end) {
            filter.date = {};
            if (start && !isNaN(start)) {
                filter.date.$gte = start;
            }
            if (end && !isNaN(end)) {
                end.setHours(23, 59, 59, 999); // include full day
                filter.date.$lte = end;
            }
        }



        // Check doctor exists
        const isExist = await User.findOne({ _id: doctorId, role: 'doctor' });
        if (!isExist) {
            return res.status(200).json({ message: 'Doctor not exist', success: false });
        }

        // Count total appointments
        const totalRecords = await DoctorAppointment.countDocuments(filter);

        // Fetch appointments with pagination
        const appointments = await DoctorAppointment.find(filter)
            .populate('prescriptionId')
            .populate({
                path: 'patientId',
                select: '-passwordHash',
                populate: {
                    path: 'patientId',
                    select: 'profileImage'
                }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            message: 'Appointments fetched successfully',
            data: appointments,
            pagination: {
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: page,
                limit
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: err?.message, success: false });
    }
};

const actionDoctorAppointment = async (req, res) => {
    const { doctorId, appointmentId, status, note } = req.body;
    try {
        const isExist = await User.findOne({ _id: doctorId, role: 'doctor' });
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });

        const isPatient = await DoctorAppointment.findById(appointmentId).populate('patientId');
        if (!isPatient) return res.status(200).json({ message: 'Appointment not exist' });

        const update = await DoctorAppointment.findByIdAndUpdate(appointmentId, { status, note }, { new: true })
        const isUser = await User.findById(update.patientId)
        if (isPatient.hospitalId && (status == "completed" || status == "rejected")) {
            const ptDept = await PatientDepartment.findOneAndUpdate({
                departmentId: isPatient.department,
                patientId: isPatient.patientId, status: 'Active', hospitalId: isPatient.hospitalId
            }, { status: 'Inactive' }, { new: true })
        }
        if (update) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: "Appointment status updated",
                    method: "UPDATE",
                    panel: req?.user?.type,
                    description: `${status} an appointment with ${isPatient?.patientId?.name} appointment id ${isPatient.customId}.`
                })
            }
            if (status == 'approved') {
                if (isUser.fcmToken) {
                    await sendPush({
                        token: isUser.fcmToken,
                        title: "Doctor Appointment Approved",
                        body: `Your appointment with ${isExist?.name} on ${new Date(isPatient?.date)?.toLocaleTimeString('en-GB')} was approved.`,
                        data: {
                            type: "Doctor Appointment Approved",
                            time: Date.now().toString()
                        }
                    });
                }
                await Notification.create({
                    userId: isPatient.patientId,
                    title: "Appointment Approved!",
                    message: `Your doctor appointment on ${new Date(isPatient.date)?.toLocaleString('en-GB')} has been approved by ${isExist.name}`
                })
            } else if (status == 'rejected') {
                if (isUser.fcmToken) {
                    await sendPush({
                        token: isUser.fcmToken,
                        title: "Doctor Appointment Rejected",
                        body: `Your appointment with ${isExist?.name} on ${new Date(isPatient?.date)?.toLocaleTimeString('en-GB')} was rejected.`,
                        data: {
                            type: "Doctor Appointment Rejected",
                            time: Date.now().toString()
                        }
                    });
                }
                await Notification.create({
                    userId: isPatient.patientId,
                    title: "Appointment Rejected!",
                    message: `Your doctor appointment on ${new Date(isPatient.date)?.toLocaleString('en-GB')} has been rejected by ${isExist.name}`
                })
            }
            return res.status(200).json({ message: "Appointment status updated", success: true })
        } else {
            return res.status(200).json({ message: "Appointment status not updated", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const cancelDoctorAppointment = async (req, res) => {
    const { patientId, appointmentId, cancelMessage } = req.body;
    try {
        const isExist = await User.findById(patientId);
        if (!isExist) return res.status(200).json({ message: 'User not exist' });

        const isPatient = await DoctorAppointment.findById(appointmentId);
        if (!isPatient) return res.status(200).json({ message: 'Appointment not exist' });

        const update = await DoctorAppointment.findByIdAndUpdate(appointmentId, { status: 'cancel', cancelMessage }, { new: true })
        if (update) {
            await Notification.create({
                userId: isPatient.doctorId,
                title: "Appointment Cancelled!",
                message: `${isExist?.name} has cancelled the doctor appointment on ${new Date(isPatient.date)?.toLocaleString('en-GB')} for ${cancelMessage}.`
            })
            return res.status(200).json({ message: "Appointment cancel successfully", success: true })
        } else {
            return res.status(200).json({ message: "Appointment not cancel", success: false })
        }
    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const cancelLabAppointment = async (req, res) => {
    const { patientId, appointmentId, cancelMessage } = req.body;
    try {
        const isExist = await User.findById(patientId);
        if (!isExist) return res.status(200).json({ message: 'User not exist' });

        const isPatient = await LabAppointment.findById(appointmentId);
        if (!isPatient) return res.status(200).json({ message: 'Appointment not exist' });

        const update = await LabAppointment.findByIdAndUpdate(appointmentId, { status: 'cancel', cancelMessage }, { new: true })
        if (update) {
            return res.status(200).json({ message: "Appointment cancel successfully", success: true })
        } else {
            return res.status(200).json({ message: "Appointment not cancel", success: false })
        }
    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}

const doctorPrescription = async (req, res) => {
    const { patientId, doctorId, medications, hospitalId, diagnosis, status, notes, appointmentId, labTest, reVisit } = req.body;
    try {
        if (medications?.length == 0) {
            return res.status(200).json({ message: "Please add at least 1 medication", success: false })
        }
        if (!diagnosis?.trim()) {
            return res.status(200).json({ message: "Please enter diganosis name", success: false })
        }
        for (let i = 0; i < medications.length; i++) {
            const med = medications[i];

            if (!med.name.trim()) {
                return res.status(200).json({ message: `Medication ${i + 1}: Name is required` });
            }

            if (!med.frequency.trim()) {
                return res.status(200).json({ message: `Medication ${i + 1}: Frequency is required` });
            }

            if (!med.duration.trim()) {
                return res.status(200).json({ message: `Medication ${i + 1}: Duration is required` });
            }

            // if (!med.refills.toString().trim()) {
            //     return res.status(200).json({ message: `Medication ${i + 1}: Refills is required` });
            // }
        }
        const isExist = await User.findOne({ role: 'doctor', _id: doctorId });
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });

        const isPatient = await User.findOne({ role: 'patient', _id: patientId });
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });

        const isAppointment = await DoctorAppointment.findById(appointmentId);
        if (!isAppointment) return res.status(200).json({ message: 'Appointment not exist' });

        const isPrescription = await Prescriptions.findOne({ appointmentId });
        if (isPrescription) return res.status(200).json({ message: 'Already prescription exist' });

        const add = await Prescriptions.create({ patientId, hospitalId, doctorId, medications, diagnosis, status, notes, appointmentId, reVisit, })
        if (add) {
            const doctorAbout = await DoctorAbout.findOne({ userId: doctorId }).populate('specialty')
            sendPatientEmail("Email Template/patient/Prescription.html",
                {
                    doctorName: isExist.name,
                    name: isPatient.name,
                    appointmentDate: isAppointment.date,
                    specialization: doctorAbout?.specialty?.name || 'General',
                    presId: add.customId,
                    createdAt: new Date(add.createdAt).toLocaleDateString('en-GB'),
                    btnLink: process.env.PATIENT_URL + '/prescription'
                },
                "New Prescription", isPatient?._id
            )
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Add a prescription`,
                    method: "CREATE",
                    panel: req?.user?.type,
                    description: `Add a prescription on a doctor appointment with ${isPatient?.name} appointment id ${isAppointment.customId}.`
                })
            }
            await Notification.create({
                userId: patientId,
                title: "New Prescription Added",
                message: `${isExist.name} has added a new prescription (id ${add?.customId}) for ${diagnosis}.`
            })
            await DoctorAppointment.findByIdAndUpdate(isAppointment._id, { prescriptionId: add._id }, { new: true })
            return res.status(200).json({ message: "Presctiption add successfully", success: true })
        } else {
            return res.status(200).json({ message: "Presctiption not added", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getDoctorPrescriptiondata = async (req, res) => {
    const prescriptionId = req.params.id;
    try {
        let isExist;
        if (prescriptionId.length < 24) {
            isExist = await Prescriptions.findOne({ customId: prescriptionId }).populate({
                path: 'doctorId', select: 'name nh12', populate: {
                    path: 'doctorId',
                    select: 'profileImage'
                }
            }).populate({ path: 'patientId', select: 'name nh12 ' });
        } else {
            isExist = await Prescriptions.findById(prescriptionId).populate({
                path: 'doctorId', select: 'name nh12', populate: {
                    path: 'doctorId',
                    select: 'profileImage'
                }
            }).populate({ path: 'patientId', select: 'name nh12 ' });
        }
        if (!isExist) return res.status(200).json({ message: 'Prescription not exist' });

        return res.status(200).json({ message: "Presctiption data fetch successfully", data: isExist, success: true })

    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const deleteDoctorPrescription = async (req, res) => {
    const prescriptionId = req.params.id;
    try {
        let isExist;
        if (prescriptionId.length < 24) {
            isExist = await Prescriptions.findOneAndDelete({ customId: prescriptionId })
        } else {
            isExist = await Prescriptions.findByIdAndDelete(prescriptionId)
        }
        if (!isExist) return res.status(200).json({ message: 'Prescription not deleted' });
        await DoctorAppointment.findByIdAndUpdate(
            isExist.appointmentId,
            { $unset: { prescriptionId: "" } } // ya agar aap delete karna chahte ho: Appointment.findByIdAndDelete(...)
        );
        return res.status(200).json({ message: "Presctiption deleted", success: true })

    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const prescriptionAction = async (req, res) => {
    const { prescriptionId, status } = req.body;
    try {
        const isExist = await Prescriptions.findById(prescriptionId).populate("patientId appointmentId");
        if (!isExist) return res.status(200).json({ message: 'Prescription not exist' });


        const update = await Prescriptions.findByIdAndUpdate(prescriptionId, { status }, { new: true })
        if (update) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Prescription status updated`,
                    method: "UPDATE",
                    panel: req?.user?.type,
                    description: `Prescription status updated ${update?.status} for ${isExist?.patientId?.name} with appointment id ${isExist?.appointmentId?.customId}.`
                })
            }
            return res.status(200).json({ message: "Prescription updated successfully", success: true })
        } else {
            return res.status(200).json({ message: "Prescription not updated", success: false })
        }
    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const editDoctorPrescription = async (req, res) => {
    const { patientId, doctorId, medications, diagnosis, status, notes, prescriptionId, appointmentId, labTest, reVisit } = req.body;
    try {
        const isExist = await User.findOne({ _id: doctorId, role: 'doctor' });
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });

        const isPatient = await User.findOne({ _id: patientId, role: 'patient' });
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });

        const isAppointment = await DoctorAppointment.findById(appointmentId);
        if (!isAppointment) return res.status(200).json({ message: 'Appointment not exist' });

        const isPrescriptions = await Prescriptions.findById(prescriptionId);
        if (!isPrescriptions) return res.status(200).json({ message: 'Patient not exist' });

        const add = await Prescriptions.findByIdAndUpdate(prescriptionId, { labTest, patientId, doctorId, reVisit, medications, diagnosis, status, notes, appointmentId }, { new: true })
        if (add) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Edit a prescription`,
                    method: "UPDATE",
                    panel: req?.user?.type,
                    description: `Edit a prescription in doctor appointment with ${isPatient?.name} appointment id ${isAppointment.customId}.`
                })
            }
            await Notification.create({
                userId: patientId,
                title: "Prescription Updated",
                message: `Dr. ${isExist.name} has updated a prescription (id ${add?.customId}) for you.`
            })
            return res.status(200).json({ message: "Presctiption update successfully", success: true })
        } else {
            return res.status(200).json({ message: "Presctiption not added", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const doctorLabTest = async (req, res) => {
    const { patientId, doctorId, labId, testId, appointmentId } = req.body;
    try {
        const isExist = await Doctor.findById(doctorId);
        if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });

        const isPatient = await Patient.findById(patientId);
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });

        const isAppointment = await DoctorAppointment.findById(appointmentId);
        if (!isAppointment) return res.status(200).json({ message: 'Appointment not exist' });

        const isLab = await Laboratory.findById(labId);
        if (!isLab) return res.status(200).json({ message: 'Lab not exist' });

        const add = await LabTest.create({ patientId, doctorId, labId, testId, appointmentId })
        if (add) {
            return res.status(200).json({ message: "Lab Test add successfully", success: true })
        } else {
            return res.status(200).json({ message: "Lab Test not added", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getPatientAppointment = async (req, res) => {
    const patientId = req.user.id || req.user.userId;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });
        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist', success: false });
        const appointments = await DoctorAppointment.find({ patientId }).populate('prescriptionId').populate('hospitalId', 'name')
            .populate({
                path: 'doctorId', select: 'name email contactNumber', populate: {
                    path: 'doctorId',
                    model: 'Doctor',
                    select: "profileImage"
                }
            }).sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .lean();
        const doctorIds = appointments.map(a => a.doctorId?._id).filter(Boolean);

        const doctorAddresses = await DoctorAbout.find({
            userId: { $in: doctorIds }
        }).select('hospitalName specialty userId fullAddress').populate('specialty', 'name').lean();

        const addressMap = {};
        doctorAddresses.forEach(addr => {
            addressMap[addr.userId.toString()] = addr;
        });

        // appointment me address attach
        const finalData = appointments.map(app => ({
            ...app,
            doctorAddress: addressMap[app.doctorId?._id?.toString()] || null
        }));


        const totalDoctorApt = await DoctorAppointment.countDocuments({ patientId: isExist._id })
        const totalLabApt = await LabAppointment.countDocuments({ patientId: isExist._id })
        if (appointments?.length > 0) {
            return res.status(200).json({
                message: "Appointment fetch successfully", totalDoctorApt, totalLabApt,
                data: finalData, totalPage: Math.ceil(totalDoctorApt / limit), success: true
            })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getPatientLabAppointment = async (req, res) => {
    const patientId = req.user.id || req.user.userId;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });
        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist', success: false });
        const appointments = await LabAppointment.find({ patientId: isExist._id }).select('-testData')
            .populate({
                path: 'tests.category',
                select: 'name'
            }).populate({
                path: 'tests.subCat.subCatId',
                select: 'subCategory'
            })
            .populate({
                path: 'labId',
                select: 'name email labId',
                populate: {
                    path: 'labId',
                    model: 'Laboratory',
                    select: 'logo'
                }
            })
            .populate({ path: 'doctorId', select: 'name' })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .lean();
        const labIds = appointments.map(a => a.labId?._id).filter(Boolean);

        const labAddresses = await LabAddress.find({
            userId: { $in: labIds }
        }).populate('countryId stateId cityId', 'name')
            .lean();

        // Map bana lo fast access ke liye
        const addressMap = {};
        labAddresses.forEach(addr => {
            addressMap[addr.userId.toString()] = addr;
        });

        // appointment me address attach
        const finalData = appointments.map(app => ({
            ...app,
            labAddress: addressMap[app.labId?._id?.toString()] || null
        }));


        const total = await LabAppointment.countDocuments({ patientId: isExist._id })
        if (appointments.length > 0) {
            return res.status(200).json({ message: "Appointment fetch successfully", total, data: finalData, totalPage: Math.ceil(total / limit), success: true })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const giveRating = async (req, res) => {
    const { patientId, doctorId, message, star, labId } = req.body;
    try {
        if (doctorId) {
            const isExist = await User.findById(doctorId);
            if (!isExist) return res.status(200).json({ message: 'Doctor not exist' });
        } else {
            const isExist = await User.findById(labId);
            if (!isExist) return res.status(200).json({ message: 'Lab not exist' });
        }
        const isPatient = await User.findById(patientId);
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });
        const add = await Rating.create({ patientId, doctorId, message, star, labId })
        if (add) {
            return res.status(200).json({ message: "Rating add successfully", success: true })
        } else {
            return res.status(200).json({ message: "Rating not added", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getLabAppointment = async (req, res) => {
    const labId = req.user.id || req.user.userId;
    const {
        page = 1,
        limit = 10,
        status,
        paymentStatus,
        dateFrom,
        dateTo,
        test,
        search
    } = req.query;

    try {
        const filter = { labId };

        // STATUS FILTER
        if (status) {
            filter.status = status;
        }

        // PAYMENT STATUS FILTER
        if (paymentStatus) {
            filter.paymentStatus = paymentStatus;
        }

        // TEST FILTER
        if (test) {
            filter.testId = { $in: [test] };
        }

        // DATE RANGE FILTER
        if (dateFrom && dateTo) {
            filter.date = {};
            if (dateFrom) filter.date.$gte = new Date(dateFrom);
            if (dateTo) filter.date.$lte = new Date(dateTo);
        }
        // Build patient search filter
        let patientMatch = {};
        if (search && search.length > 0) {
            patientMatch = {
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } },
                    { nh12: { $regex: search, $options: "i" } }
                ]
            };
        }
        // PATIENT NAME FILTER (requires lookup after populate)
        let appointmentQuery = LabAppointment.find(filter)
            .populate({ path: 'tests.category', model: 'test-category' })
            .populate({ path: 'doctorId', select: 'name email contactNumber nh12' })
            .populate({ path: 'patientId', select: 'name email contactNumber nh12 patientId', match: patientMatch, populate: { path: "patientId", select: 'profileImage' } })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        let appointment = await appointmentQuery;

        // Filter by patient name AFTER populate
        appointment = appointment.filter(a => a.patientId)

        const totalAppointment = await LabAppointment.countDocuments(filter);

        return res.status(200).json({
            message: "Appointments fetched successfully",
            data: appointment,
            success: true,
            totalPages: Math.ceil(totalAppointment / limit)
        });

    } catch (err) {
        console.log(err);
        return res.status(200).json({ message: err?.message });
    }
};

const getLabAppointmentData = async (req, res) => {
    const appointmentId = req.params.id;
    try {
        let isExist;
        if (appointmentId.length < 24) {
            isExist = await LabAppointment.findOne({ customId: appointmentId }).populate({ path: 'tests.subCat.subCatId' }).populate('tests.category')
                .populate({ path: 'staff', select: 'name nh12 ' })
                .populate({ path: 'patientId', select: 'name email contactNumber nh12 patientId', populate: ({ path: 'patientId', select: 'name email contactNumber gender ' }) })
                .populate({ path: 'labId', select: 'name email contactNumber nh12 labId', populate: ({ path: 'labId', select: 'name logo gstNumber' }) }).lean()
                .populate({ path: 'doctorId', select: 'name email contactNumber nh12 doctorId' }).populate("invoiceId")
        } else {
            isExist = await LabAppointment.findById(appointmentId).populate({ path: 'tests.subCat.subCatId' }).populate('tests.category')
                .populate({ path: 'staff', select: 'name nh12' })
                .populate({ path: 'patientId', select: 'name email contactNumber nh12 patientId', populate: ({ path: 'patientId', select: 'name email contactNumber gender ' }) })
                .populate({ path: 'labId', select: 'name email contactNumber nh12 labId', populate: ({ path: 'labId', select: 'name logo gstNumber' }) }).lean()
                .populate({ path: 'doctorId', select: 'name email contactNumber nh12 doctorId' }).populate("invoiceId")
        }
        const labAddress = await LabAddress.findOne({ userId: isExist?.labId?._id }).populate('countryId stateId cityId', 'name')
        const labReports = await TestReport.find({ appointmentId: isExist?._id }).populate('testId')
        const demographic = await PatientDemographic.findOne({ userId: isExist.patientId._id })

        if (!isExist) return res.status(200).json({ message: 'Appointment not exist' });
        return res.status(200).json({ message: "Appointment fetch successfully", data: isExist, labAddress, labReports, demographic, success: true })
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const labDashboardData = async (req, res) => {
    const labId = req.params.id;
    try {
        const isExist = await User.findById(labId);
        if (!isExist) return res.status(200).json({ message: 'Lab not exist' });
        const pendingTestRequest = await LabAppointment.countDocuments({ labId: isExist._id, status: 'pending' })
        const deliverRequest = await LabAppointment.countDocuments({ labId: isExist._id, status: 'deliver-report' })
        const pendingReport = await LabAppointment.countDocuments({ labId: isExist._id, status: 'pending-report' })
        const totalTest = await Test.countDocuments({ labId: isExist._id })
        const totalTestRequest = await LabAppointment.countDocuments({ labId: isExist._id })
        const testRequests = { totalTestRequest }
        const labReports = { pendingReport, deliverRequest, pendingTestRequest }
        return res.status(200).json({
            message: "Dashboard data fetch successfully", labReports, testRequests, totalTest
            , success: true
        })

    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}

const bookLabAppointment = async (req, res) => {
    const { patientId, labId, testId, date, status, doctorId, doctorAp, tests, manualDoctor } = req.body;
    const insertUser = req.user.id || req.user.userId

    try {
        const isExist = await User.findById(labId);
        if (!isExist) return res.status(200).json({ message: 'Laboratory not exist' });

        const isInsert = await User.findById(insertUser)

        const isPatient = await User.findById(patientId);
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });

        // ✅ tests array se saare subCatIds nikalo (flat)
        const allSubCatIds = (tests || [])
            .flatMap(t => t.subCat || [])
            .map(id => id.toString())

        if (!allSubCatIds.length) {
            return res.status(200).json({ message: "Please select at least one test", success: false });
        }

        const labTestDocs = await Test.find({ _id: { $in: testId } }).populate('subCatData.subCat');

        if (!labTestDocs.length) {
            return res.status(200).json({ message: "Invalid test IDs", success: false });
        }

        const isProfessional = ['hospital', 'doctor', 'staff', 'lab'].includes(isInsert.role)

        // ✅ Price with 5% logic
        const applyMarkup = (price) => isProfessional
            ? Math.round(price + (price * 5 / 100))
            : price

        // ✅ tests array build karo schema ke according
        const testsWithPrice = []
        let totalFees = 0

        for (const testEntry of tests) {
            const catId = testEntry.category?.toString()
            const selectedSubCatIds = (testEntry.subCat || []).map(id => id.toString())

            const testDoc = labTestDocs.find(
                t => t.category?._id?.toString() === catId
                    || t.category?.toString() === catId
            )
            if (!testDoc) continue

            const activeSubCats = testDoc.subCatData.filter(s => s.status === 'active')
            const activeSubCatIds = activeSubCats.map(s => s.subCat?._id.toString())

            const isAllSelected = activeSubCatIds.length > 0 &&
                activeSubCatIds.every(id => selectedSubCatIds.includes(id))

            const subCatWithPrice = []
            for (const selectedId of selectedSubCatIds) {
                const subEntry = activeSubCats.find(s => s.subCat?._id.toString() === selectedId)
                if (!subEntry) continue

                const subCatPrice = applyMarkup(subEntry.price)
                subCatWithPrice.push({
                    subCatId: selectedId,
                    code: subEntry.subCat?.code || '',  // ✅ code bhi save karo
                    subCatPrice
                })

                if (!isAllSelected) totalFees += subCatPrice
            }

            let categoryPrice = undefined
            if (isAllSelected) {
                categoryPrice = applyMarkup(testDoc.totalAmount)
                totalFees += categoryPrice
            }

            testsWithPrice.push({
                testId: testDoc._id,        // ✅ testId ab tests ke andar
                category: catId,
                ...(categoryPrice !== undefined && { categoryPrice }),
                subCat: subCatWithPrice
            })
        }

        // ✅ Appointment save — testId array hata diya
        const book = await LabAppointment.create({
            patientId,
            labId,
            manualDoctor,
            tests: testsWithPrice,   // testId ab iske andar hai
            date,
            fees: totalFees,
            status,
            doctorAp,
            doctorId
        })

        if (book) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Add a lab appointment`,
                    method: "CREATE", panel: req?.user?.type,
                    description: `Add a lab appointment with ${isPatient?.name} appointment id ${book.customId}.`
                })
            }

            if (isExist.fcmToken) {
                await sendPush({
                    token: isExist.fcmToken,
                    title: "New Appointment",
                    body: `${isPatient?.name} booked an appointment for tests on ${new Date(date).toLocaleTimeString('en-GB')}`,
                    data: { type: "New Appointment", time: Date.now().toString() }
                });
            }

            if (isPatient.fcmToken) {
                await sendPush({
                    token: isPatient.fcmToken,
                    title: "New Appointment",
                    body: `You booked an appointment on ${new Date(date).toLocaleTimeString('en-GB')} with ${isExist?.name}`,
                    data: { type: "New Appointment", time: Date.now().toString() }
                });
            }

            await Notification.create({
                userId: labId,
                title: "New Appointment Request!",
                message: `You have received a new appointment request from ${isPatient.name} on ${new Date(date).toLocaleString('en-GB')}.`
            });

            res.status(200).json({
                message: "Appointment booked successfully",
                success: true,
                data: book
            });
            const existingAppointments = await LabAppointment.find({
                patientId,
                labId,
                status: { $ne: "cancel" }
            });
            let duplicateAppointment = null;

            for (const appointment of existingAppointments) {

                const existingSubCatIds = appointment.tests
                    .flatMap(t => t.subCat || [])
                    .map(s => s.subCatId.toString())
                    .sort();

                const isSameTests =
                    JSON.stringify(existingSubCatIds) === JSON.stringify(allSubCatIds);

                if (isSameTests) {
                    duplicateAppointment = appointment;
                    break;
                }
            }
            if (duplicateAppointment) {
                const testNames = testsWithPrice
                    .flatMap(test =>
                        test.subCat.map(sub => {

                            const matchedTest = labTestDocs.find(
                                doc => doc._id.toString() === test.testId.toString()
                            );

                            const matchedSubCat = matchedTest?.subCatData?.find(
                                s => s.subCat?._id?.toString() === sub.subCatId.toString()
                            );

                            return matchedSubCat?.subCat?.subCategory;

                        })
                    )
                    .filter(Boolean)
                    .join(", ");
                sendLabEmail(

                    "Email Template/Laboratory/ReTestRequest.html",

                    {
                        patientName: isPatient?.name,
                        testName: testNames,
                        prevAptId: duplicateAppointment?.customId,
                        requestedOn: new Date(date)?.toLocaleDateString('en-GB'),
                        btnLink: process.env.LABORATORY_URL + `/appointment-details/${book?._id}`
                    },

                    "Re Test Request",

                    labId

                );

            }

        } else {
            res.status(200).json({
                message: "Appointment not booked",
                success: false
            });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err?.message, success: false });
    }
};
const rescheduleLabAppointment = async (req, res) => {
    const { appointmentId, date } = req.body;
    const patientId = req.user.id || req.user.userId
    try {
        const isExist = await LabAppointment.findById(appointmentId);
        if (!isExist) return res.status(200).json({ message: 'Lab appointment not exist' });

        const isPatient = await User.findById(patientId);
        if (!isPatient) return res.status(200).json({ message: 'Patient not exist' });

        await LabAppointment.findByIdAndUpdate(appointmentId, { date, status: "pending" }, { new: true })
        return res.status(200).json({
            message: "Appointment reschedule successfully",
            success: true,
        });

    } catch (err) {
        console.log(err);
        return res.status(200).json({ message: err?.message });
    }
};

const actionLabAppointment = async (req, res) => {
    const { labId, appointmentId, status, note, type, paymentStatus, staff } = req.body;

    try {
        const isExist = await User.findById(labId);
        if (!isExist) return res.status(200).json({ message: 'Lab not exist' });

        const isPatient = await LabAppointment.findById(appointmentId).populate('patientId');
        if (!isPatient) return res.status(200).json({ message: 'Appointment not exist' });

        let updateData = { note, staff };
        if (type === 'payment') {
            updateData.paymentStatus = paymentStatus;
        } else if (status) {
            updateData.status = status;
        }

        const update = await LabAppointment.findByIdAndUpdate(appointmentId, updateData, { new: true });

        if (!update) {
            return res.status(200).json({ message: "Appointment status not updated", success: false });
        }

        // Only send notifications if the status is updated
        if (updateData.status) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Action on lab appointment`,
                    method: "UPDATE",
                    panel: req?.user?.type,
                    description: `${updateData.status} an lab appointment with ${isPatient?.patientId?.name} appointment id ${isPatient.customId}.`
                })
            }
            const isUser = await User.findById(isPatient.patientId);

            if (updateData.status === 'approved') {
                if (isUser.fcmToken) {
                    await sendPush({
                        token: isUser.fcmToken,
                        title: "Lab Appointment Approved",
                        body: `Your appointment with ${isExist?.name} on ${new Date(isPatient.date)?.toLocaleTimeString('en-GB')} was approved.`,
                        data: {
                            type: "Lab Appointment Approved",
                            time: Date.now().toString()
                        }
                    });
                }

                await Notification.create({
                    userId: isPatient.patientId,
                    title: "Appointment Approved!",
                    message: `Your lab appointment on ${new Date(isPatient.date)?.toLocaleDateString('en-GB')} has been approved by ${isExist.name}`
                });

            } else if (updateData.status === 'rejected') {
                if (isUser.fcmToken) {
                    await sendPush({
                        token: isUser.fcmToken,
                        title: "Lab Appointment Rejected",
                        body: `Your appointment with ${isExist?.name} on ${new Date(isPatient.date)?.toLocaleTimeString('en-GB')} was rejected.`,
                        data: {
                            type: "Lab Appointment Rejected",
                            time: Date.now().toString()
                        }
                    });
                }

                await Notification.create({
                    userId: isPatient.patientId,
                    title: "Appointment Rejected!",
                    message: `Your lab appointment on ${new Date(isPatient.date)?.toLocaleDateString('en-GB')} has been rejected by ${isExist.name}`
                });
            }
        }

        return res.status(200).json({ message: "Appointment status updated", success: true });

    } catch (err) {
        console.error(err);
        return res.status(200).json({ message: 'Server Error' });
    }
};
const paymentLabAppointment = async (req, res) => {
    const { labId, appointmentId, status, note, type, paymentStatus } = req.body;
    try {
        const isExist = await User.findById(labId);
        if (!isExist) return res.status(200).json({ message: 'Lab not exist' });

        const isPatient = await LabAppointment.findById(appointmentId).populate("patientId");
        if (!isPatient) return res.status(200).json({ message: 'Appointment not exist' });

        const update = await LabAppointment.findByIdAndUpdate(appointmentId, { paymentStatus, note }, { new: true })
        if (update) {
            if (['hospital', 'doctor', 'lab', 'pharmacy'].includes(req?.user?.type)) {
                await AuditLog.create({
                    orgId: req?.user?.id || req?.user?.userId, actorId: req?.user?.loginUser || req?.user?.id || req?.user?.userId,
                    shortDesc: `Payment status on lab appointment`,
                    method: "UPDATE",
                    panel: req?.user?.type,
                    description: `Payment status on lab appointment with ${isPatient?.patientId?.name} appointment id ${isPatient.customId}.`
                })
            }
            return res.status(200).json({ message: "Appointment status updated", success: true })
        } else {
            return res.status(200).json({ message: "Appointment status not updated", success: false })
        }

    } catch (err) {
        return res.status(200).json({ message: err?.message });
    }
}
const getLabReport = async (req, res) => {
    const patientId = req.params.id;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });

        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist' });
        const appointment = await TestReport.find({ patientId: isExist?._id }).populate('appointmentId')
            .populate({ path: 'labId', select: 'name customId ' })
            .populate({ path: 'subCatId', select: 'subCategory' }).sort({ createdAt: -1 })
            .skip((page - 1) * 10)
            .limit(limit).lean()
        const totalData = await TestReport.countDocuments({ patientId: isExist?._id })

        if (appointment) {
            return res.status(200).json({
                message: "Report fetch successfully", data: appointment,
                pagination: {
                    totalData,
                    currentPage: page,
                    totalPage: Math.ceil(totalData / limit)
                },
                success: true
            })
        } else {
            return res.status(200).json({ message: "Report not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getNearByDoctor = async (req, res) => {
    const { page = 1, limit = 10 } = req.query
    try {
        const doctors = await User.find({ role: 'doctor' }).sort({ createdAt: -1 })
            .skip((page - 1) * 10)
            .limit(limit)

        const totalData = await User.countDocuments({ role: 'doctor' })

        return res.status(200).json({
            message: "Report fetch successfully", data: doctors,
            pagination: {
                totalData,
                currentPage: page,
                totalPage: Math.ceil(totalData / limit)
            },
            success: true
        })

    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getDoctorAppointmentData = async (req, res) => {
    const appointmentId = req.params.id;
    try {
        let isExist;
        if (appointmentId.length < 24) {
            isExist = await DoctorAppointment.findOne({ customId: appointmentId }).populate('hospitalId', 'name')
                .populate({ path: 'patientId', select: 'name email contactNumber nh12 patientId', populate: ({ path: 'patientId', select: 'gnder profileImage' }) })
                .populate({ path: 'doctorId', select: 'name email contactNumber nh12 doctorId', populate: ({ path: 'doctorId', select: 'profileImage' }) }).lean()
                .populate({
                    path: 'labTest.tests.category',
                    select: 'name'
                }).populate({
                    path: 'labTest.tests.subCat',
                    select: 'subCategory'
                })
                .populate('prescriptionId').lean();
        } else {

            isExist = await DoctorAppointment.findById(appointmentId).populate('hospitalId', 'name')
                .populate({ path: 'patientId', select: 'name email contactNumber nh12 patientId', populate: ({ path: 'patientId', select: 'gender profileImage' }) })
                .populate({ path: 'doctorId', select: 'name email contactNumber nh12 doctorId', populate: ({ path: 'doctorId', select: 'name profileImage' }) }).lean()
                .populate({
                    path: 'labTest.tests.category',
                    select: 'name'
                }).populate({
                    path: 'labTest.tests.subCat',
                    select: 'subCategory'
                })
                .populate('prescriptionId').lean();
        }
        const doctorAddress = await DoctorAbout.findOne({ userId: isExist?.doctorId?._id }).select('fullAddress hospitalName specialty').populate('specialty', 'name')
        // const labReports = await TestReport.find({ appointmentId: isExist?._id }).populate('testId')
        const labAppointment = await LabAppointment.findOne({ doctorAp: isExist._id })
        if (!isExist) return res.status(200).json({ message: 'Appointment not exist' });
        return res.status(200).json({ message: "Appointment fetch successfully", data: isExist, doctorAddress, success: true, labAppointment })
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getDoctorPastAppointment = async (req, res) => {
    const patientId = req.params.patientId;
    const doctorId = req.params.doctorId;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });
        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist', success: false });
        const appointments = await DoctorAppointment.find({ patientId, doctorId }).populate('prescriptionId')
            .populate({
                path: 'labTest.tests.subCat',
            })
            .populate({
                path: 'labTest.tests.category',
            }).lean();

        const appointmentIds = appointments.map(a => a._id);

        const labAppointments = await LabAppointment.find({
            doctorAp: { $in: appointmentIds }
        }).lean();

        const labApptIds = labAppointments.map(l => l._id);

        const reports = await TestReport.find({
            appointmentId: { $in: labApptIds }
        }).lean();
        const reportMap = {};

        for (const report of reports) {
            const labApptId = report.appointmentId.toString();
            if (!reportMap[labApptId]) {
                reportMap[labApptId] = [];
            }
            reportMap[labApptId].push(report);
        }
        const labAppointmentMap = {};

        for (const labAppt of labAppointments) {
            const doctorApptId = labAppt.doctorAp.toString();

            labAppt.reports = reportMap[labAppt._id.toString()] || [];

            if (!labAppointmentMap[doctorApptId]) {
                labAppointmentMap[doctorApptId] = [];
            }
            labAppointmentMap[doctorApptId].push(labAppt);
        }
        const finalAppointments = appointments.map(appt => {
            const labAppts = labAppointmentMap[appt._id.toString()] || [];
            return {
                ...appt,
                labAppointment: labAppts.length > 0 ? labAppts[0] : null
            };
        });
        const totalDoctorApt = await DoctorAppointment.countDocuments({ patientId: isExist._id })
        if (appointments?.length > 0) {
            return res.status(200).json({
                message: "Appointment fetch successfully", totalDoctorApt,
                data: finalAppointments, totalPage: Math.ceil(totalDoctorApt / limit), success: true
            })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getHospitalAppointment = async (req, res) => {
    try {
        const hospitalId = req.params.id;

        // Parse pagination params with defaults
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || '';
        const statuses = req.query.statuses || ''
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const doctorId = req.query.doctorId
        const customId = req.query.search
        const deptType = req.query.deptType

        const skip = (page - 1) * limit;

        let filter = { hospitalId };
        if (status) {
            filter.status = status;
        }
        if (customId) {
            filter.customId = customId
        }
        if (deptType) {
            const matchingDepts = await Department.find({
                userId: hospitalId,
                type: deptType
            }).select('_id').lean()

            const deptIds = matchingDepts.map(d => d._id)
            filter.department = { $in: deptIds }
        }
        if (statuses) {
            filter.status = { $in: statuses.split(',') };
        }
        if (doctorId && mongoose.Types.ObjectId.isValid(doctorId)) {
            filter.doctorId = new mongoose.Types.ObjectId(doctorId);
        }
        const start = startDate && startDate !== 'null' ? new Date(startDate) : null;
        const end = endDate && endDate !== 'null' ? new Date(endDate) : null;

        if (start || end) {
            filter.date = {};
            if (start && !isNaN(start)) {
                filter.date.$gte = start;
            }
            if (end && !isNaN(end)) {
                end.setHours(23, 59, 59, 999); // include full day
                filter.date.$lte = end;
            }
        }

        const totalRecords = await DoctorAppointment.countDocuments(filter);

        // Fetch appointments with pagination
        const appointments = await DoctorAppointment.find(filter).select('-labTest')
            .populate('prescriptionId').populate('department', 'departmentName')
            .populate({
                path: 'patientId',
                select: 'name nh12',
                populate: {
                    path: 'patientId',
                    select: 'profileImage'
                }
            })
            .populate({
                path: 'doctorId',
                select: 'name nh12',
                populate: {
                    path: 'doctorId',
                    select: 'profileImage'
                }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            message: 'Appointments fetched successfully',
            data: appointments,
            pagination: {
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: page,
                limit
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: err?.message, success: false });
    }
};
const getHospitalPastAppointment = async (req, res) => {
    const patientId = req.params.patientId;
    const hospitalId = req.params.hospitalId;
    const { page = 1, limit = 10 } = req.query
    const skip = (page - 1) * limit;
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });
        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist', success: false });
        const isHospital = await User.findById(hospitalId);
        if (!isHospital) {
            return res.status(200).json({ message: 'Hospital not exist', success: false });
        }
        // const doctorAdd = await StaffEmployement.find({ organizationId: hospitalId })
        // const doctorIds = doctorAdd.map(item => item.userId)
        const appointments = await DoctorAppointment.find({ patientId, hospitalId }).sort({ createdAt: -1 }).skip(skip)
            .limit(limit).populate('prescriptionId')
            .populate({
                path: 'doctorId',
                select: 'name nh12',
                populate: { path: 'doctorId', select: 'profileImage' }
            }).lean();
        // .populate({
        //     path: 'labTest.lab',
        //     model: 'User',
        //     populate: { path: 'labId', select: 'logo' }
        // })
        // .populate({
        //     path: 'labTest.labTests',
        //     model: 'Test'
        // })

        // const appointmentIds = appointments.map(a => a._id);

        // const labAppointments = await LabAppointment.find({
        //     doctorAp: { $in: appointmentIds }
        // }).lean();

        // const labApptIds = labAppointments.map(l => l._id);

        // const reports = await TestReport.find({
        //     appointmentId: { $in: labApptIds }
        // }).lean();
        // const reportMap = {};

        // for (const report of reports) {
        //     const labApptId = report.appointmentId.toString();
        //     if (!reportMap[labApptId]) {
        //         reportMap[labApptId] = [];
        //     }
        //     reportMap[labApptId].push(report);
        // }
        // const labAppointmentMap = {};

        // for (const labAppt of labAppointments) {
        //     const doctorApptId = labAppt.doctorAp.toString();

        //     labAppt.reports = reportMap[labAppt._id.toString()] || [];

        //     if (!labAppointmentMap[doctorApptId]) {
        //         labAppointmentMap[doctorApptId] = [];
        //     }
        //     labAppointmentMap[doctorApptId].push(labAppt);
        // }
        // const finalAppointments = appointments.map(appt => {
        //     const labAppts = labAppointmentMap[appt._id.toString()] || [];
        //     return {
        //         ...appt,
        //         labAppointment: labAppts.length > 0 ? labAppts[0] : null
        //     };
        // });
        const totalDoctorApt = await DoctorAppointment.countDocuments({ patientId: isExist._id })
        if (appointments?.length > 0) {
            return res.status(200).json({
                message: "Appointment fetch successfully", totalDoctorApt,
                data: appointments, totalPage: Math.ceil(totalDoctorApt / limit), success: true
            })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}

const getPastPatientLabAppointment = async (req, res) => {
    const patientId = req.params.patientId;
    const labId = req.params.labId;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });
        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist', success: false });
        const appointments = await LabAppointment.find({ patientId: isExist._id, labId }).sort({ createdAt: -1 })
            .populate({
                path: 'tests.category',
                select: 'name'
            })
            .populate({
                path: 'labId',
                select: 'name email labId',
                populate: {
                    path: 'labId',
                    model: 'Laboratory',
                    select: 'logo name'
                }
            })
            .populate({ path: 'doctorId', select: 'name' })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .lean();
        const labIds = appointments.map(a => a.labId?._id).filter(Boolean);

        const labAddresses = await LabAddress.find({
            userId: { $in: labIds }
        }).populate('countryId stateId cityId', 'name')
            .lean();

        // Map bana lo fast access ke liye
        const addressMap = {};
        labAddresses.forEach(addr => {
            addressMap[addr.userId.toString()] = addr;
        });

        // appointment me address attach
        const finalData = appointments.map(app => ({
            ...app,
            labAddress: addressMap[app.labId?._id?.toString()] || null
        }));


        const total = await LabAppointment.countDocuments({ patientId: isExist._id, labId })
        if (appointments.length > 0) {
            return res.status(200).json({ message: "Appointment fetch successfully", total, data: finalData, totalPage: Math.ceil(total / limit), success: true })
        } else {
            return res.status(200).json({ message: "Appointment not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
//      get patient lab report for specific lab
const getPatientLabReport = async (req, res) => {
    const patientId = req.params.patientId;
    const labId = req.params.labId;
    const { page = 1, limit = 10 } = req.query
    try {
        let isExist;
        if (patientId?.length < 24) {
            isExist = await User.findOne({ unique_id: patientId });

        } else {
            isExist = await User.findById(patientId);
        }
        if (!isExist) return res.status(200).json({ message: 'Patient not exist' });
        const appointment = await TestReport.find({ patientId: isExist?._id, labId }).populate('appointmentId')
            .populate({ path: 'labId', select: 'name customId ' })
            .populate({ path: 'subCatId', select: "subCategory" }).sort({ createdAt: -1 })
            .skip((page - 1) * 10)
            .limit(limit).lean()
        const totalData = await TestReport.countDocuments({ patientId: isExist?._id, labId })
        if (appointment) {
            return res.status(200).json({
                message: "Report fetch successfully", data: appointment,
                pagination: {
                    totalData,
                    currentPage: page,
                    totalPage: Math.ceil(totalData / limit)
                },
                success: true
            })
        } else {
            return res.status(200).json({ message: "Report not found", success: false })
        }
    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const getHospitalDoctorAppointment = async (req, res) => {
    const hospitalId = req.user.id
    try {
        const doctorId = req.params.id;

        // Parse pagination params with defaults
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || '';
        const statuses = req.query.statuses || ''
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        const skip = (page - 1) * limit;

        let filter = { doctorId, hospitalId };
        if (status) {
            filter.status = status;
        }
        if (statuses) {
            filter.status = { $in: statuses.split(',') };
        }
        const start = startDate && startDate !== 'null' ? new Date(startDate) : null;
        const end = endDate && endDate !== 'null' ? new Date(endDate) : null;

        if (start || end) {
            filter.date = {};
            if (start && !isNaN(start)) {
                filter.date.$gte = start;
            }
            if (end && !isNaN(end)) {
                end.setHours(23, 59, 59, 999); // include full day
                filter.date.$lte = end;
            }
        }



        // Check doctor exists
        const isExist = await User.findOne({ _id: doctorId, role: 'doctor' });
        if (!isExist) {
            return res.status(200).json({ message: 'Doctor not exist', success: false });
        }

        // Count total appointments
        const totalRecords = await DoctorAppointment.countDocuments(filter);

        // Fetch appointments with pagination
        const appointments = await DoctorAppointment.find(filter)
            .populate('prescriptionId')
            .populate({
                path: 'patientId',
                select: '-passwordHash',
                populate: {
                    path: 'patientId',
                    select: 'profileImage'
                }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            message: 'Appointments fetched successfully',
            data: appointments,
            pagination: {
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: page,
                limit
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: err?.message, success: false });
    }
};
const doctorAptPayment = async (req, res) => {
    const id = req.user.id || req.user.userId;
    const { appointmentId, subTotal, totalAmount, discountValue = 0, discountType, paymentMethod } = req.body;

    try {
        const isUser = await User.findById(id);
        if (!isUser) {
            return res.status(400).json({ message: 'User not exist', success: false });
        }

        const isApt = await DoctorAppointment.findById(appointmentId).populate('patientId', 'name nh12');
        if (!isApt) {
            return res.status(400).json({ message: 'Appointment not exist', success: false });
        }

        // ✅ BASIC VALIDATIONS
        if (subTotal < 0 || totalAmount < 0) {
            return res.status(400).json({
                message: 'Amount cannot be negative',
                success: false
            });
        }

        if (discountValue < 0) {
            return res.status(400).json({
                message: 'Discount cannot be negative',
                success: false
            });
        }

        let calculatedTotal = subTotal;

        // ✅ DISCOUNT VALIDATION
        if (discountType === "Fixed") {
            if (Number(discountValue) > Number(subTotal)) {
                return res.status(400).json({
                    message: 'Discount cannot be greater than subtotal',
                    success: false
                });
            }
            calculatedTotal = Number(subTotal) - Number(discountValue);
        }

        if (discountType === "Percentage") {
            if (Number(discountValue) > 100) {
                return res.status(400).json({
                    message: 'Percentage discount cannot exceed 100%',
                    success: false
                });
            }
            calculatedTotal = subTotal - (subTotal * Number(discountValue) / 100);
        }

        // ✅ FINAL SAFETY CHECK
        if (calculatedTotal < 0) {
            return res.status(400).json({
                message: 'Final amount cannot be negative',
                success: false
            });
        }

        // Optional: match frontend total with backend calculation
        if (Number(totalAmount) !== Number(calculatedTotal)) {
            return res.status(400).json({
                message: 'Total amount mismatch. Please refresh and try again.',
                success: false
            });
        }

        // ✅ CREATE DATA
        const data = {
            ...req.body,
            totalAmount: calculatedTotal,
            doctorId: isApt.doctorId,
            patientId: isApt.patientId
        };

        if (isApt.hospitalId) {
            data.hospitalId = isApt.hospitalId;
        }

        const paymentInfo = await PaymentInfo.findOne({ userId: id });
        if (!paymentInfo) {
            return res.status(400).json({
                message: 'Payment information not found',
                success: false
            });
        }

        data.paymentInfoId = paymentInfo._id;

        const payment = await DoctorAptPayment.create(data);

        if (payment) {
            await DoctorAppointment.findByIdAndUpdate(
                appointmentId,
                { paymentStatus: 'paid', invoiceId: payment._id },
                { new: true }
            );
            await AuditLog.create({
                orgId: req.user.id || req.user.userId,
                actorId: req.user.loginUser || req.user.id || req.user.userId,
                method: "CREATE",
                panel: req.user.type,
                shortDesc: "Payment added for Appointment",
                description: `Payment added for  Appointment Id ${isApt.customId} for patient ${isApt.patientId?.name} with amount ₹ ${calculatedTotal}`
            })

            return res.status(200).json({
                message: 'Payment successful',
                success: true,
                data: payment
            });
        } else {
            return res.status(400).json({
                message: 'Payment failed',
                success: false
            });
        }

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: 'Server Error',
            success: false
        });
    }
};
const getDoctorAptPayment = async (req, res) => {
    const id = req.params.id;
    try {
        const isApt = await DoctorAptPayment.findById(id).populate('doctorId', 'name nh12').populate('patientId', 'name').populate('paymentInfoId')
        if (!isApt) return res.status(200).json({ message: 'Appointment Payment not exist' })
        return res.status(200).json({ message: 'Payment fetch successful', success: true, data: isApt })


    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
const doctorAptVitals = async (req, res) => {
    const id = req.user.id || req.user.userId;
    const { appointmentId, } = req.body;
    try {
        const isUser = await User.findById(id);
        if (!isUser) {
            return res.status(400).json({ message: 'User not exist', success: false });
        }
        const isApt = await DoctorAppointment.findByIdAndUpdate(appointmentId, { vitals: req.body }, { new: true }).populate('patientId', 'name')
        if (!isApt) return res.status(200).json({ message: 'Appointment  not exist' })
        await AuditLog.create({
            orgId: req.user.id || req.user.userId,
            actorId: req.user.loginUser || req.user.id || req.user.userId,
            panel: req.user.type,
            method: "CREATE",
            shortDesc: "Vitals added",
            description: `Added vitals in doctor appointment no. ${isApt?.customId} of patient ${isApt?.patientId?.name}`
        })
        return res.status(200).json({ message: 'Vitals add in doctor appointment', success: true, data: isApt })


    } catch (err) {
        console.log(err)
        return res.status(200).json({ message: err?.message });
    }
}
export {
    bookDoctorAppointment, actionDoctorAppointment, cancelDoctorAppointment, getLabAppointmentData, getPatientLabReport,
    doctorLabTest, doctorPrescription, editDoctorPrescription, getDoctorAppointment, labDashboardData, getHospitalDoctorAppointment,
    getPatientAppointment, giveRating, getPatientLabAppointment, getLabAppointment, bookLabAppointment, paymentLabAppointment, actionLabAppointment,
    getLabReport, getDoctorPrescriptiondata, getNearByDoctor, cancelLabAppointment, getDoctorAppointmentData, getPastPatientLabAppointment,
    getDoctorPastAppointment, deleteDoctorPrescription, prescriptionAction, updateDoctorAppointment, getHospitalAppointment, getHospitalPastAppointment,
    doctorAptPayment, getDoctorAptPayment, doctorAptVitals, rescheduleLabAppointment
}