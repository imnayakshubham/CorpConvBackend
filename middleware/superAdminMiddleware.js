const isSuperAdmin = (user) => {
    if (!user) return false;
    const superAdminIds = process.env.SUPER_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
    return superAdminIds.includes((user._id || user.id)?.toString());
};

const superAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authorized' });
    if (!isSuperAdmin(req.user)) return res.status(403).json({ message: 'Super admin access required' });
    next();
};

module.exports = { superAdmin, isSuperAdmin };
