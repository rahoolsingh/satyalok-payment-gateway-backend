import mongoose from "mongoose";

/**
 * Canonical donor record.
 *
 * Keyed by an HMAC of the normalised email so the same person pledging twice
 * (or donating one-time and then pledging) can be recognised without keeping a
 * plaintext lookup index. Pledges store their own snapshot of the donor details
 * because a receipt must reflect the data as it was at the time of the debit.
 */
const donorSchema = new mongoose.Schema(
    {
        donorKey: { type: String, required: true, unique: true, index: true },

        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        phone: { type: String, required: true, trim: true },

        panEncrypted: { type: String, default: null },
        panMasked: { type: String, default: null },
        taxBenefit: { type: Boolean, default: false },

        emailVerifiedAt: { type: Date, default: null },
        phoneVerifiedAt: { type: Date, default: null },
        consentVersion: { type: String, default: null },

        totalDonatedPaise: { type: Number, default: 0 },
        lastDonatedAt: { type: Date, default: null },

        isBlocked: { type: Boolean, default: false },
        blockReason: { type: String, default: null },
    },
    { timestamps: true },
);

donorSchema.index({ email: 1, phone: 1 });

const Donor = mongoose.model("Donor", donorSchema);

export default Donor;
