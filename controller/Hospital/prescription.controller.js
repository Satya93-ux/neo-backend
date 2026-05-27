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

    res.json({
      success: true,
      message: "Prescription updated"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Update failed"
    });
  }
};
