"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validate_1 = require("../../utils/validate");
const slugs_1 = require("../../server/utils/slugs");
describe('generateSlug', () => {
    test('strips invalid chars', () => {
        const inputs = ['foo', 'foo bar', 'foo~!$/bar'];
        for (const input of inputs) {
            expect((0, validate_1.isSlugValid)((0, slugs_1.generateSlug)(input))).toBe(true);
        }
    });
    test('makes unique', () => {
        expect((0, slugs_1.getCollisionSafeSlug)((0, slugs_1.generateSlug)('slug exists'), [
            'slug-exists',
            'slug-exists-as-prefix',
            'existing',
        ])).toBe('slug-exists-3');
    });
});
