const superAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authorized' });

    const superAdminIds = process.env.SUPER_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
    const isSuperAdmin =
        superAdminIds.includes(req.user._id?.toString());

    if (!isSuperAdmin) return res.status(403).json({ message: 'Super admin access required' });
    next();
};

module.exports = { superAdmin };
