import bcrypt from "bcrypt";
import { Request, Response } from "express";
import { FileAccessRequestSchema } from "~/schemas";
import { manuallyDeleteFile } from "~/background-tasks";
import { ErrorResponseTemplates } from "../response-templates";

export class ShareHandlers {
    public static async GET(req: Request, res: Response) {
        const { id } = req.params;

        // 1. Check if this file exists in the records
        const fileRecord = await prisma.share.findUnique({
            where: { id }
        });
        if (!fileRecord) {
            const badRequest = ErrorResponseTemplates.badRequestTemplate("Not Found. This might be either deleted already, expired, or never existed at all.", {});
            console.log(badRequest);
            res.statusCode = badRequest.status;
            res.statusMessage = badRequest.statusText;
            res.json(badRequest);
            return;
        }

        // format share link and expiration date
        const shareLinkRoute = `/files/view/${fileRecord.viewId}`;
        const formatter = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        });
        const expiration = formatter.format(new Date(fileRecord.expiration));
        
        res.render('share', { expiration, shareLinkRoute, shareId: id });
    }

    public static async POST(req: Request, res: Response) {
        const { id } = req.params;
        const body = req.body;
        
        // 1. Check if share file exists
        const fileShareRecord = await prisma.share.findUnique({
            where: { id },
            include: {
                view: {
                    select: {
                        hashedPassphrase: true,
                        fileId: true
                    }
                }
            }
        });
        if (!fileShareRecord) {
            const badRequest = ErrorResponseTemplates.badRequestTemplate("Not Found. This might be either deleted already, expired, or never existed at all.", {})
            res.statusCode = badRequest.status;
            res.statusMessage = badRequest.statusText;
            res.json(badRequest);
            return;
        }

        // 2. Check if passphrase is sent
        const parsedBody = FileAccessRequestSchema.safeParse(body);
        if (parsedBody.error) {
            const error = parsedBody.error.flatten().fieldErrors;
            const badRequest = ErrorResponseTemplates.badRequestTemplate("Invalid request body", error as {[key: string] : string});
            res.statusCode = badRequest.status;
            res.statusMessage = badRequest.statusText;
            res.json(badRequest);
            return;
        }

        // 3. Check if correct passphrase
        const storedHashedPass = fileShareRecord.view.hashedPassphrase;
        const enteredPassphrase = parsedBody.data.passphrase;
        const isMatch = bcrypt.compare(enteredPassphrase, storedHashedPass);
        if (!isMatch) {
            const unauthorizedError = ErrorResponseTemplates.unauthorizedTemplate("Incorrect Passphrase", { 'passphrase': 'Incorrect Passphrase' });
            res.statusCode = unauthorizedError.status;
            res.statusMessage = unauthorizedError.statusText;
            res.json(unauthorizedError);
            return;
        }

        // 4. Delete file manually: File in Pinata, file record in DB, and file-deletion job
        await manuallyDeleteFile(fileShareRecord.view.fileId, fileShareRecord.id);

        res.redirect('/upload');

    }
}
