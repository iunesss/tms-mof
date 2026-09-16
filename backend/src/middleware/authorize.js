function authorize(...allowedRoles) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];

    if (userRoles.includes('SUPER_ADMIN')) {
      return next();
    }

    const hasPermission = allowedRoles.some((role) =>
      userRoles.includes(role)
    );

    if (!hasPermission) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'ليس لديك تصريح للوصول إلى هذا المورد.',
      });
    }

    next();
  };
}

module.exports = { authorize };