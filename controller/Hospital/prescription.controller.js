import Prescription from "../../models/Hospital/Prescription.js";

/* =========================================
   ADD PRESCRIPTION
========================================= */
export const addPrescription = async (req, res) => {
  try {
    const hospitalId = req.user.id;

    const {
      doctorId,
      patientId,
      bedId,
      diagnosis,
      medications,
      notes,
      status // ✅ ADD
    } = req.body;

    if (!doctorId || !patientId || !diagnosis || !medications?.length) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing"
      });
    }

    const prescription = await Prescription.create({
      hospitalId,
      doctorId,
      patientId,
      bedId: bedId || null,
      diagnosis,
      medications,
      notes,
      status: status || "Active" // ✅ SAFE DEFAULT
    });

    // Emit socket event with updated payload immediately after saving
    try {
      const io = req.app.get('socketio');
      const onlineUsers = req.app.get('onlineUsers');
      if (io) {
        io.emit("new-prescription", prescription);
        if (onlineUsers) {
          if (patientId) {
            const patientSocketId = onlineUsers.get(patientId.toString());
            if (patientSocketId) {
              io.to(patientSocketId).emit("new-prescription", prescription);
            }
          }
          if (doctorId) {
            const doctorSocketId = onlineUsers.get(doctorId.toString());
            if (doctorSocketId) {
              io.to(doctorSocketId).emit("new-prescription", prescription);
            }
          }
        }
      }
    } catch (socketErr) {
      console.error("Socket emit error in hospital addPrescription:", socketErr);
    }

    res.json({
      success: true,
      message: "Prescription added successfully",
      data: prescription
    });

  } catch (err) {
    console.error("Add Prescription Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

/* =========================================
   GET PRESCRIPTIONS BY PATIENT
========================================= */
export const getPrescriptionsByPatient = async (req, res) => {
  try {
    const { patientId } = req.params;

    const prescriptions = await Prescription.find({ patientId })
      .populate("doctorId", "name")
      .populate("bedId", "bedName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: prescriptions
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to load prescriptions"
    });
  }
};

/* =========================================
   GET SINGLE PRESCRIPTION
========================================= */
export const getPrescriptionById = async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate("doctorId", "name")
      .populate("patientId", "name age gender")
      .populate("bedId", "bedName");

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found"
      });
    }

    res.json({
      success: true,
      data: prescription
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to load prescription"
    });
  }
};

/* =========================================
   UPDATE PRESCRIPTION
========================================= */
export const updatePrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found"
      });
    }

    prescription.diagnosis = req.body.diagnosis;
    prescription.medications = req.body.medications;
    prescription.notes = req.body.notes;
    prescription.status = req.body.status || prescription.status;

    await prescription.save();

    // Emit socket event with updated payload immediately after saving
    try {
      const io = req.app.get('socketio');
      const onlineUsers = req.app.get('onlineUsers');
      if (io) {
        io.emit("new-prescription", prescription);
        if (onlineUsers) {
          const patientId = prescription.patientId;
          const doctorId = prescription.doctorId;
          if (patientId) {
            const patientSocketId = onlineUsers.get(patientId.toString());
            if (patientSocketId) {
              io.to(patientSocketId).emit("new-prescription", prescription);
            }
          }
          if (doctorId) {
            const doctorSocketId = onlineUsers.get(doctorId.toString());
            if (doctorSocketId) {
              io.to(doctorSocketId).emit("new-prescription", prescription);
            }
          }
        }
      }
    } catch (socketErr) {
      console.error("Socket emit error in hospital updatePrescription:", socketErr);
    }

    res.json({
      success: true,
      message: "Prescription updated",
      data: prescription
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Update failed"
    });
  }
};
