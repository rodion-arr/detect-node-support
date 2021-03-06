'use strict';

const Fs = require('fs');
const Path = require('path');

const Utils = require('../utils');


exports.create = async (path) => {

    const simpleGit = Utils.simpleGit(path);
    const isRepo = await simpleGit.checkIsRepo();

    if (!isRepo) {
        throw new Error(`${path} is not a git repository`);
    }

    if (!Fs.existsSync(Path.join(path, 'package.json'))) {
        throw new Error(`${path} does not contain a package.json`);
    }

    return {
        getCommit: () => {

            return simpleGit.revparse(['HEAD']);
        },
        loadFile: (filename, options = {}) => {

            const fullPath = Path.join(path, filename);

            const buffer = Fs.readFileSync(fullPath);

            if (options.json) {
                return JSON.parse(buffer.toString());
            }

            return buffer;
        }
    };
};
