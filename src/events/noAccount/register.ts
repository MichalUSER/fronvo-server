// ******************** //
// The register no-account-only event file.
// ******************** //

import { AccountData } from '@prisma/client';
import bcrypt from 'bcrypt';
import { EventTemplate, FronvoError } from 'interfaces/all';
import {
    RegisterResult,
    RegisterServerParams,
} from 'interfaces/noAccount/register';
import * as variables from 'variables/global';
import utilities from 'utilities/all';
import { findDocuments } from 'utilities/global';
import { accountSchema } from './shared';

async function register({
    io,
    socket,
    email,
    password,
}: RegisterServerParams): Promise<RegisterResult | FronvoError> {
    // Check if the email is from a dummy (blacklisted) domain, if applicable
    if (variables.blacklistedEmailDomainsEnabled) {
        if (
            variables.blacklistedEmailDomains.indexOf(
                utilities.getEmailDomain(email)
            ) > -1
        ) {
            return utilities.generateError('REQUIRED_EMAIL');
        }
    }

    const accounts: { accountData: AccountData }[] = await findDocuments(
        'Account',
        { select: { accountData: true } }
    );

    // Check if the email is already registered by another user
    for (const account in accounts) {
        const accountData = accounts[account].accountData;

        if (accountData.email == email) {
            return utilities.generateError('ACCOUNT_ALREADY_EXISTS');
        }
    }

    // Generate the account once all checks have passed
    const username =
        'Fronvo user ' +
        (accounts != null ? Object.keys(accounts).length + 1 : '1');
    const id = utilities.convertToId(username);

    await utilities.createAccount({
        id,
        email,
        username,
        password: !variables.testMode
            ? bcrypt.hashSync(password, variables.mainBcryptHash)
            : password,
    });

    // Also login to the account
    utilities.loginSocket(io, socket, id);

    return {
        token: await utilities.createToken(id),
    };
}

const registerTemplate: EventTemplate = {
    func: register,
    template: ['email', 'password'],
    points: 5,
    schema: accountSchema,
};

export default registerTemplate;
