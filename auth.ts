import { PrismaClient, User } from '@prisma/client';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'your_jwt_secret';
const prisma = new PrismaClient();

export async function generateToken(user: User): Promise<string> {
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    await prisma.user.update({ where: { id: user.id }, data: { token } });
    return token;
}

export async function authenticateUser(token: string, JWT_SECRET: string, prisma: PrismaClient): Promise<{ id: number, username: string } | null> {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number, username: string };
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (user && user.token === token) {
            return { id: user.id, username: user.username };
        } else {
            return null;
        }
    } catch (error) {
        return null;
    }
}
