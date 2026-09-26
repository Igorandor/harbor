ARG IRIS_IMAGE=intersystemsdc/iris-community@sha256:68bc1d43c98ca816f2e98a185edc1250bebb6b763f8159da35c8543b09c0df70
FROM ${IRIS_IMAGE}
COPY --chown=irisowner:irisowner iris/ /opt/harbor-iris/
RUN iris start IRIS \
    && iris session IRIS -U %SYS < /opt/harbor-iris/configure.script \
    && iris session IRIS -U %SYS < /opt/harbor-iris/install.script \
    && iris stop IRIS quietly
# Initialization was completed at build time. Use the vendor supervisor directly;
# the community convenience SQL initializer is not needed for this image.
ENTRYPOINT ["/tini", "--", "/iris-main"]
CMD ["--check-caps", "false"]
