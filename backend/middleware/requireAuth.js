import { verifyToken } from "../auth/tokens.js";

export function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const decoded = verifyToken(token);
        req.user = { id: decoded.sub, role: decoded.role };
        next();
    } catch (err) {
        return res.status(401).json({ error: "Unauthorized" });
    }
}