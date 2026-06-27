import jwt from "jsonwebtoken";
import "dotenv/config";

const secret = process.env.JWT_SECRET;

if (!secret) {
    throw new Error("JWT_SECRET is not defined in .env");
}

export const signToken = (payload) => {
    return jwt.sign(payload, secret, { expiresIn: "7d" });
};

export const verifyToken = (token) => {
    return jwt.verify(token, secret);
};
